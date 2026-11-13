/* PIN-backed operator access; the header is resolved at request time after operator switches. */
async function initTerminal() {
  terminalContext.id=terminalId();
  if(typeof supabase!=='undefined') cloud=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init={})=>{const headers=new Headers(init.headers);if(operatorContext.token)headers.set('x-operator-session',operatorContext.token);return fetch(input,{...init,headers});}}
  });
  try{await initOperatorAccess();scheduleSync();}catch(error){$('operatorMessage').textContent=error.message;}finally{hideBoot();}
}
