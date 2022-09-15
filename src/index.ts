#!/usr/bin/env node

import { program } from 'commander';
import { daemon } from './daemon';
const pj = require('../package.json');

program
    .name(pj.name)
    .description(pj.description)
    .version(pj.version)
    .option('--conf <config-file>', 'config file location (default: ~/.defichain-compound)')
    .action((options) => {
        daemon(options);
    });

program.parse();