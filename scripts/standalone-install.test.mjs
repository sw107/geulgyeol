import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
function fixture(files){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'geulgyeol-install-guard-'));
 const repo=path.join(temp,'repo');fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});
 for(const f of files)fs.copyFileSync(path.join(root,'scripts',f),path.join(repo,'scripts',f));
 return {temp,repo};
}
test('setup refuses an external node_modules link before npm can alter its target',()=>{
 const {temp,repo}=fixture(['setup-standalone.sh']);
 try{
  fs.mkdirSync(path.join(repo,'desktop'));fs.mkdirSync(path.join(repo,'rhwp-studio'));
  const target=path.join(temp,'external');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'sentinel'),'keep');
  fs.symlinkSync(target,path.join(repo,'desktop/node_modules'));
  const r=spawnSync('bash',['scripts/setup-standalone.sh'],{cwd:repo,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing linked installation destination/);
  assert.equal(fs.readFileSync(path.join(target,'sentinel'),'utf8'),'keep');
  assert(fs.lstatSync(path.join(repo,'desktop/node_modules')).isSymbolicLink());
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('Mac Rust installation refuses an external nested tool before executing it',{skip:process.platform!=='darwin'||process.arch!=='arm64'},()=>{
 const {temp,repo}=fixture(['install-standalone-rust.sh','standalone-env.sh']);
 try{
  const bin=path.join(repo,'.geulgyeol-tools/cargo-home/bin');fs.mkdirSync(bin,{recursive:true});
  const marker=path.join(temp,'executed'),tool=path.join(temp,'external-rustup');
  fs.writeFileSync(tool,'#!/bin/sh\ntouch "'+marker+'"\nexit 37\n',{mode:0o755});
  fs.symlinkSync(tool,path.join(bin,'rustup'));
  const r=spawnSync('bash',['scripts/install-standalone-rust.sh'],{cwd:repo,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing external tool link/);assert(!fs.existsSync(marker));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
