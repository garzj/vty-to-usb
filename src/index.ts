import './config/env';
import './config/paths';
console.log(`Starting app in ${process.env.NODE_ENV} mode.`);

import { App } from './App';
new App();

console.log(`Ready! Waiting for connections.`);
