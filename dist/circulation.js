(function(root,factory){const api=factory(typeof module==='object'?require('./engine'):root.WishEngine);if(typeof module==='object')module.exports=api;else root.WishCirculation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E){
  'use strict';
  // 0.15 m orthogonal grid; a 0.60 m walking envelope avoids furniture.
  // Distances end at each module's door, not its bed/desk use position.
  function measure(rooms,interior){
    const living=rooms.find(r=>r.type.startsWith('living'));if(!living)return {routes:[],reachable:0,total:0,averageM:0,maxM:0,score:0};
    const nodes=[],links=[],byRoom=new Map(),half=.30/E.CELL_METERS,step=.15/E.CELL_METERS;
    for(const r of rooms){const data=interior.byRoom[r.id],ports=[];if(!data)continue;
      const nx=Math.max(0,Math.floor((r.w-2*half)/step)+1),ny=Math.max(0,Math.floor((r.h-2*half)/step)+1),free=new Uint8Array(nx*ny);
      const point=i=>({x:half+(i%nx)*step,y:half+Math.floor(i/nx)*step});
      for(let i=0;i<free.length;i++){const p=point(i);free[i]=!data.furniture.some(f=>p.x>f.x-half+1e-6&&p.x<f.x+f.w+half-1e-6&&p.y>f.y-half+1e-6&&p.y<f.y+f.h+half-1e-6);}
      for(const door of data.doors){if(door.width*E.CELL_METERS<.6)continue;const mid=door.start+door.width/2,p={x:door.side==='west'?half:door.side==='east'?r.w-half:mid,y:door.side==='north'?half:door.side==='south'?r.h-half:mid};
        let cell=-1,best=step*step*1.1;for(let i=0;i<free.length;i++){if(!free[i])continue;const q=point(i),d=(q.x-p.x)**2+(q.y-p.y)**2;if(d<best){cell=i;best=d;}}
        const index=nodes.length;nodes.push({roomId:r.id,door,cell});links.push([]);ports.push(index);
      }
      byRoom.set(r.id,ports);
      for(const source of ports){const cell=nodes[source].cell;if(cell<0)continue;const distance=new Int32Array(free.length).fill(-1),queue=[cell];distance[cell]=0;
        for(let head=0;head<queue.length;head++){const i=queue[head],x=i%nx,y=Math.floor(i/nx);for(const next of [x>0?i-1:-1,x+1<nx?i+1:-1,y>0?i-nx:-1,y+1<ny?i+nx:-1])if(next>=0&&free[next]&&distance[next]<0){distance[next]=distance[i]+1;queue.push(next);}}
        for(const dest of ports)if(dest!==source&&nodes[dest].cell>=0&&distance[nodes[dest].cell]>=0)links[source].push({to:dest,m:distance[nodes[dest].cell]*.15});
      }
    }
    nodes.forEach((n,i)=>{if(!n.door.to||n.cell<0)return;for(const j of byRoom.get(n.door.to)||[]){const other=nodes[j];if(other.door.to===n.roomId&&other.cell>=0)links[i].push({to:j,m:.6});}});
    const starts=(byRoom.get(living.id)||[]).filter(i=>nodes[i].door.kind==='entry'&&nodes[i].cell>=0),dist=nodes.map(()=>Infinity),prev=nodes.map(()=>-1),todo=new Set(nodes.map((_,i)=>i));starts.forEach(i=>dist[i]=0);
    while(todo.size){const i=[...todo].sort((a,b)=>dist[a]-dist[b])[0];todo.delete(i);if(!Number.isFinite(dist[i]))break;for(const edge of links[i])if(dist[i]+edge.m<dist[edge.to]){dist[edge.to]=dist[i]+edge.m;prev[edge.to]=i;}}
    const routes=rooms.filter(r=>r.id!==living.id).map(r=>{const ports=byRoom.get(r.id)||[],end=ports.sort((a,b)=>dist[a]-dist[b])[0],reachable=end!==undefined&&Number.isFinite(dist[end]);let roomIds=[];if(reachable){for(let i=end;i!==-1;i=prev[i])if(roomIds.at(-1)!==nodes[i].roomId)roomIds.push(nodes[i].roomId);roomIds.reverse();}return {roomId:r.id,reachable,distanceM:reachable?Math.round(dist[end]*100)/100:null,via:roomIds.slice(1,-1)};});
    const reached=routes.filter(r=>r.reachable),averageM=reached.length?reached.reduce((n,r)=>n+r.distanceM,0)/reached.length:0,maxM=Math.max(0,...reached.map(r=>r.distanceM)),privatePasses=reached.reduce((n,r)=>n+r.via.filter(id=>E.isBedroom(rooms.find(r=>r.id===id))).length,0);
    return {routes,reachable:reached.length,total:routes.length,averageM,maxM,privatePasses,score:(routes.length-reached.length)*10000+privatePasses*100+averageM*10+maxM*5};
  }
  return {measure};
});
