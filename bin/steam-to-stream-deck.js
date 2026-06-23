#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { convertPlugin } = require('../src');

function usage() {
  console.error('Usage: steam-to-stream-deck <source-plugin-dir> <output-plugin-dir>');
}

const [, , sourceArg, outputArg] = process.argv;
if (!sourceArg || !outputArg) {
  usage();
  process.exit(2);
}

const sourceRoot = path.resolve(sourceArg);
const outputRoot = path.resolve(outputArg);
const report = convertPlugin(sourceRoot, outputRoot);
console.log(JSON.stringify(report, null, 2));
