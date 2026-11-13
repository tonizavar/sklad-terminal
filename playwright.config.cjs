const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests',testMatch:'*.spec.cjs',timeout:30000,workers:1,
 use:{baseURL:'http://127.0.0.1:4173',headless:true,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
 webServer:{command:'node tests/server.cjs',port:4173,reuseExistingServer:false},
});
