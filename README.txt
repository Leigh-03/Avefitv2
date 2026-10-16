Install client dependencies:
cd client
npm install
npm run dev - to run the front end

Install server dependencies:
cd server
npm install 
npm run dev - to run the backend

PostgreSQL configuration:
- Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in server/.env,
  or provide DATABASE_URL.
- Remote database hosts use TLS by default. Set DB_SSL=false only if your
  database provider explicitly requires an unencrypted connection.
- Localhost connections use no TLS by default. Set DB_SSL=true to require TLS.
- Configure the same variables in your backend hosting provider's environment;
  a local .env file is not deployed with the application.