"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.basicAuth = basicAuth;
const config_1 = __importDefault(require("../config"));
function basicAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="401"');
        res.status(401).send('Autenticação necessária.');
        return;
    }
    const [type, credentials] = authHeader.split(' ');
    if (type !== 'Basic' || !credentials) {
        res.status(401).send('Autenticação inválida.');
        return;
    }
    const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
    const [login, password] = decoded.split(':');
    if (login === config_1.default.auth.login && password === config_1.default.auth.password) {
        next();
        return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Autenticação necessária.');
    return;
}
