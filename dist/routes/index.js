"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/index.ts
const express_1 = require("express");
const EmailController_1 = __importDefault(require("../controllers/EmailController"));
const StatusController_1 = __importDefault(require("../controllers/StatusController"));
const auth_1 = require("../middleware/auth");
const asyncHandler_1 = __importDefault(require("../utils/asyncHandler"));
const router = (0, express_1.Router)();
// Middleware de autenticação para todas as rotas abaixo
router.use(auth_1.basicAuth);
// Rotas de envio
router.post('/send', (0, asyncHandler_1.default)(EmailController_1.default.sendNormal));
// Rota de status
router.get('/status', (0, asyncHandler_1.default)(StatusController_1.default.getStatus));
exports.default = router;
