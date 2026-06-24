const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:4000",
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: "cd ../PixelPandemonium_Server && npm start",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "bundle exec jekyll serve --host 127.0.0.1 --port 4000",
      url: "http://127.0.0.1:4000",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium"
      }
    }
  ]
});
