import {JWT} from 'google-auth-library';
import {readGoogleSheetsWorkspaceSource} from './google-sheets-source.mjs';

const READONLY_SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';

export function createGoogleSheetsService({spreadsheetId='',clientEmail='',privateKey='',fetchImpl=fetch,tokenProvider}={}) {
  const normalizedKey=String(privateKey).replace(/\\n/g,'\n');
  const configured=Boolean(spreadsheetId&&clientEmail&&normalizedKey.includes('BEGIN PRIVATE KEY'));
  let client;
  return {
    configured,
    spreadsheetId:spreadsheetId||null,
    async read() {
      if(!configured)throw new Error('Google Sheets 연결 설정이 필요합니다.');
      if(!client)client=new JWT({email:clientEmail,key:normalizedKey,scopes:[READONLY_SCOPE]});
      const token=tokenProvider?await tokenProvider():await client.getAccessToken();
      const accessToken=typeof token==='string'?token:token?.token;
      if(!accessToken)throw new Error('Google Sheets 접근 토큰을 받지 못했습니다.');
      return readGoogleSheetsWorkspaceSource({spreadsheetId,accessToken,fetchImpl});
    },
  };
}
