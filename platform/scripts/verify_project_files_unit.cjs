const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let result;
const context={window:{PyRunner:{run:async()=>result}},setTimeout,console,
  location:{hash:''},document:{getElementById:()=>null}};
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/project-courses.js'),'utf8');
const marker='  window.ProjectCourses =';assert.ok(source.includes(marker));
vm.runInNewContext(source.replace(marker,'  window.checkStageForTest = checkStage;\n'+marker),context);
(async()=>{
  const artifacts=[{name:'report.xlsx',data:'UEsDBA=='}];
  for(const check of [{append:"print('OK')",expect:'OK'},{}]){
    result={stdout:'OK',user_stdout:'',check_stdout:'OK',artifacts};
    const good=await context.window.checkStageForTest({check},'pass',()=>{});
    assert.equal(good.ok,true);assert.equal(good.artifacts,artifacts);
    result={error:'intentional failure',stdout:'partial',artifacts};
    const bad=await context.window.checkStageForTest({check},'pass',()=>{});
    assert.equal(bad.ok,false);assert.equal(bad.artifacts,artifacts);
  }
  result={stdout:'wrong',check_stdout:'wrong',artifacts};
  const mismatch=await context.window.checkStageForTest({check:{expect:'OK'}},'pass',()=>{});
  assert.equal(mismatch.ok,false);assert.equal(mismatch.artifacts,artifacts);
  console.log('PASS project files: checked/plain runs retain owned artifacts on success/error; mismatch remains failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
