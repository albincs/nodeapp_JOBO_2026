import express from "express";
console.log('server.js: module evaluation start');
import cors from "cors";
import serverless from "serverless-http";
import sequelize from "./config/database.js";

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

import routes from "./routes/index.js";
import dashboardRoutes from "./routes/dashboard.js";
// import swaggerUi from 'swagger-ui-express';
// import swaggerSpecs from './config/swagger.js';
// AdminJS will be lazy-loaded inside startServer to avoid bundling during ESM evaluation

app.use(cors());
app.use('/static', express.static('static'));
app.use('/uploads', express.static('public/uploads'));

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));
// NOTE: body parsing and API route mounting happen inside startServer AFTER AdminJS is mounted

export const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log("Database connected successfully.");
    
    // Sync models (disable in production if using migrations)
    // await sequelize.sync({ alter: true }); 
    
    // Lazy-load AdminJS after DB is ready to avoid bundling during module import
    try {
      const adminMod = await import('./config/admin.js');
      if (adminMod && adminMod.adminJs && adminMod.adminRouter) {
        // Ensure any earlier body-parsing flags don't trigger AdminJS's OldBodyParserUsedError.
        // Log and reset `req._body` for admin routes only to help debugging.
        app.use(adminMod.adminJs.options.rootPath, (req, res, next) => {
          try {
            console.log('[admin-debug] pre-admin req._body =', req && req._body);
          } catch (e) {}
          if (req && Object.prototype.hasOwnProperty.call(req, '_body')) {
            try { delete req._body; } catch (e) { req._body = false; }
          }
          try {
            console.log('[admin-debug] post-admin req._body =', req && req._body);
          } catch (e) {}
          next();
        }, adminMod.adminRouter);
        console.log('AdminJS mounted at', adminMod.adminJs.options.rootPath);
      }
    } catch (e) {
      console.error('Failed to load AdminJS module at startup:', e);
    }

    // Body parsing and API routes must be registered AFTER AdminJS router
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mount API routes
    app.use('/api', routes);
    app.use('/api/dashboard', dashboardRoutes);

    // Serve standalone dashboard
    app.get('/dashboard', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
    });

    // Serve Angular Static Files if present
    const frontendPath = path.join(__dirname, '../public/frontend');
    const hasFrontend = fs.existsSync(frontendPath);
    if (hasFrontend) {
      app.use(express.static(frontendPath));

      // Handle Angular Routing (Catch-all) - Must be AFTER API routes
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
            return res.status(404).json({ error: 'Not Found' });
        }
        // For /admin we call next so AdminJS can handle the route
        if (req.path.startsWith('/admin')) {
          return next();
        }
        res.sendFile(path.join(frontendPath, 'index.html'));
      });
    } else {
      // Frontend not deployed — respond with a simple API root and avoid trying to serve missing files
      app.get('/', (req, res) => {
        res.json({ status: 'API running', info: 'Frontend not deployed on this package' });
      });
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
            return res.status(404).json({ error: 'Not Found' });
        }
        // Allow AdminJS routes (mounted earlier) to handle /admin paths
        if (req.path.startsWith('/admin')) {
          return next();
        }
        res.status(404).send('Frontend not deployed');
      });
    }

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
};

export const handler = serverless(app);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startServer();
}
