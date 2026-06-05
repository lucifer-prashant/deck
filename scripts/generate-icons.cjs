#!/usr/bin/env node
// scripts/generate-icons.cjs
// Converts build/icons/256x256.png → build/icons/icon.ico
// Run with: node scripts/generate-icons.cjs
// Requires: npm install png-to-ico (listed in devDependencies)

const pngToIco = require('png-to-ico')
const fs = require('fs')
const path = require('path')

const srcPng = path.join(__dirname, '..', 'build', 'icons', '256x256.png')
const destIco = path.join(__dirname, '..', 'build', 'icons', 'icon.ico')

pngToIco(srcPng)
  .then(buf => {
    fs.writeFileSync(destIco, buf)
    console.log('✓ Generated', destIco)
  })
  .catch(err => {
    console.error('✗ Icon generation failed:', err)
    process.exit(1)
  })
