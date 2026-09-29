'use client';
import { createApiClient } from './core';

// Access tokens are passed by callers from memory; no browser storage is used.
export const api = createApiClient();
