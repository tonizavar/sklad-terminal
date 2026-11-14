const {defineConfig}=require('@playwright/test');
const port=Number(process.env.PLAYWRIGHT_PORT||4173);
const baseURL=`http://127.0.0.1:${port}`;
module.exports=defineConfig({
 testDir:'./tests',testMatch:'*.spec.cjs',timeout:30000,workers:1,
 use:{baseURL,headless:true,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
 webServer:{command:'node tests/server.cjs',url:baseURL,reuseExistingServer:false},
});
