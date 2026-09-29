import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import storageRouter from "./storage";
import alertsRouter from "./alerts";
import marketRouter from "./market";
import watchlistRouter from "./watchlist";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(storageRouter);
router.use(marketRouter);
// Before watchlist/alerts: those routers apply requireAuth to everything after them.
router.use(telegramRouter);
router.use(watchlistRouter);
router.use(alertsRouter);

export default router;
