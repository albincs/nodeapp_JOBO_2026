Backend API deployment package

Contents:
- src/
- package.json
- package-lock.json (optional)
- .env (keep secure; override on server)
- access_env.js
- public/uploads/ (if any uploaded files required)

Deploy steps:
1. Unzip package on target server.
2. From package root run: npm install --production
3. Ensure .env values are correct on the server (do NOT commit secrets to repo).
4. Start the server: 
pm start (or use PM2/systemd to run as a service).

Notes:
- The package excludes the frontend build (public/frontend) since frontend is already deployed.
- If you need node_modules included, ask and I will create a full package with node_modules.
