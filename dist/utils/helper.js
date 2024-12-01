"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
// src/utils/helper.ts
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
