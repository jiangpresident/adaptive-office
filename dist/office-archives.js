(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./office-model.js'));
  else root.OfficeArchives=factory(root.OfficeModel);
}(typeof window!=='undefined'?window:globalThis,function(M){
  'use strict';
  function create(state,name,id,createdAt){
    const building=M.validate(state);
    if(building.gridSize!==4)throw Error('存档需要 4 m 网格。');
    const axes=M.lanes();
    const modules=building.floors.flatMap((f,fi)=>M.displayGeometry(building,f).map(c=>({
      id:c.id,program:c.program,userId:c.userId,automaticRoof:!!c.automaticRoof,supportId:c.supportId||null,floorId:f.id,floorIndex:fi,lane:c.lane,
      side:c.side,column:axes.slice(0,c.lane+1).filter(a=>a.side===c.side).length,
      depth:c.offset/4+1,position:{x:c.x+2,y:fi*4+2,z:c.z+2},size:{x:4,y:4,z:4}
    })));
    return {format:'office-building-snapshot-v1',id,name:String(name).trim().slice(0,80)||'未命名存档',createdAt,
      coordinates:{unit:'m',origin:'核心筒地面中心',y:'向上',x:'向东',z:'向南',position:'4 m 模块包络中心'},
      building,modules,summary:M.stats(building)};
  }
  function read(value){
    if(value?.format!=='office-building-snapshot-v1'||typeof value.id!=='string'||!value.id||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw Error('存档格式无效。');
    if(value.building?.gridSize!==4)throw Error('仅支持 4 m 网格存档。');
    const result=create(value.building,value.name,value.id,value.createdAt);
    if(value.aiRun?.format==='office-ai-run-v1'&&typeof value.aiRun.prompt==='string'&&Number.isInteger(value.aiRun.multiplier)&&value.aiRun.multiplier>=1&&value.aiRun.multiplier<=100&&JSON.stringify(M.validate(value.aiRun.target))===JSON.stringify(result.building)){result.aiRun=JSON.parse(JSON.stringify(value.aiRun));}
    return result;
  }
  function pair(from,to){
    from=read(from);to=read(to);
    if(from.id===to.id)throw Error('请选择两个不同的存档。');
    return {format:'office-dispatch-request-v1',createdAt:new Date().toISOString(),from,to,
      matchingPolicy:'按用途与实际位置匹配可复用模块；逻辑 ID 不代表不可更换用途的实体模块。',
      status:'待调度计算',note:'包含起点与目标楼体；仓库库存、临时腾挪和搬运顺序由调度系统另行计算。'};
  }
  return {create,read,pair};
}));
