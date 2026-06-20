import express from 'express';
import router from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api/v1', router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
