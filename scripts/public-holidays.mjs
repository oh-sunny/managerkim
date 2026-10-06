const endpoint='https://nagerholidays.com/api/v3/publicholidays';
const cacheDurationMs=6*60*60*1000;

export function createPublicHolidayCalendar({fetcher=fetch}={}) {
  const yearCache=new Map();
  return {
    configured:true,
    async get(years) {
      const selected=[...new Set(years)].filter(year=>Number.isInteger(year)&&year>=2000&&year<=2100);
      if(!selected.length||selected.length>4)throw Object.assign(new Error('조회할 연도를 확인해주세요.'),{status:400});
      const holidays=[];
      const fetchedAt=[];
      for(const year of selected){
        const cached=yearCache.get(year);
        if(cached&&Date.now()-cached.at<cacheDurationMs){holidays.push(...cached.days);fetchedAt.push(cached.at);continue;}
        const response=await fetcher(`${endpoint}/${year}/KR`,{signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw Object.assign(new Error('공휴일 달력에 연결하지 못했습니다. 잠시 후 다시 확인해주세요.'),{status:502});
        let entries;
        try{entries=await response.json();}catch{entries=null;}
        if(!Array.isArray(entries)||!entries.length){
          throw Object.assign(new Error('공휴일 목록을 확인할 수 없습니다.'),{status:502});
        }
        const days=entries.filter(item=>item?.global===true&&item.types?.includes('Public'))
          .map(item=>item.date)
          .filter(value=>typeof value==='string'&&new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(value));
        if(!days.length)throw Object.assign(new Error('전국 공휴일 목록이 비어 있습니다.'),{status:502});
        const at=Date.now();yearCache.set(year,{at,days});fetchedAt.push(at);
        holidays.push(...days);
      }
      return {status:'success',source:'Nager.Date 공개 공휴일 달력',checkedAt:new Date(Math.min(...fetchedAt)).toISOString(),holidays:[...new Set(holidays)].sort()};
    },
  };
}
