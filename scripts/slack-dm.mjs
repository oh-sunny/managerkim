export function createSlackDm({token='',fetcher=fetch}={}) {
  const configured=Boolean(token&&/^xoxb-/.test(token)&&!token.includes('your_'));
  const request=async(method,payload)=>{
    let response;
    try{
      response=await fetcher(`https://slack.com/api/${method}`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=utf-8'},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(5000),
      });
    }catch{return {status:'unknown',reason:'network'};}
    let result;
    try{result=await response.json();}catch{return {status:'unknown',reason:'invalid_response'};}
    if(!response.ok){return {status:response.status>=500||response.status===429?'unknown':'failed',reason:`http_${response.status}`};}
    if(result?.ok!==true)return {status:'failed',reason:typeof result?.error==='string'?result.error:'slack_error'};
    return {status:'success',data:result};
  };
  async function sendText({email,body}) {
    if(!configured)throw new Error('Slack is not configured');
    const identity=await request('users.lookupByEmail',{email});
    if(identity.status!=='success')return {status:identity.status,stage:'lookup',reason:identity.reason};
    const userId=identity.data?.user?.id;
    if(!/^[UW][A-Z0-9]+$/.test(userId||''))return {status:'failed',stage:'lookup',reason:'invalid_user'};
    const opened=await request('conversations.open',{users:userId});
    if(opened.status!=='success')return {status:opened.status,stage:'open',reason:opened.reason};
    const channel=opened.data?.channel?.id;
    if(!/^[DG][A-Z0-9]+$/.test(channel||''))return {status:'failed',stage:'open',reason:'invalid_channel'};
    const posted=await request('chat.postMessage',{channel,text:body});
    if(posted.status!=='success')return {status:posted.status,stage:'post',reason:posted.reason};
    if(!posted.data.ts)return {status:'unknown',stage:'post',reason:'missing_timestamp'};
    return {status:'success',stage:'post',slackUserId:userId,channelId:channel,ts:String(posted.data.ts)};
  }
  return {configured,sendText};
}
