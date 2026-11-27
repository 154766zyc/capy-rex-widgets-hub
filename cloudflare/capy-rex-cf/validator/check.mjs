import {inspectSource} from '../nas/validation.mjs';
let input='';const timer=setTimeout(()=>process.exit(124),5000);timer.unref();
try{for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2*1024*1024)throw Error('文件超过 2 MiB');}console.log(JSON.stringify({ok:true,mode:'static-only',...inspectSource(input)}));}catch(e){console.log(JSON.stringify({ok:false,mode:'static-only',error:e.message}));process.exitCode=1;}
