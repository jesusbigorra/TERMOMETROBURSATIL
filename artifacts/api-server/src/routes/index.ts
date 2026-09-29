import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import storageRouter from "./storage";
import alertsRouter from "./alerts";
import marketRouter from "./market";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(storageRouter);
router.use(marketRouter);
router.use(watchlistRouter);
router.use(alertsRouter);

export default router;
