/* ─── PALETTE + FONTS ─── */
const P = {
  bg0:'#060d18',bg1:'#0b1725',bg2:'#0f1e30',bg3:'#152739',bg4:'#1c3050',
  bdr:'#1e3450',bdrHi:'#284e6a',
  teal:'#2dd4a0',tealDim:'rgba(45,212,160,0.09)',tealMid:'rgba(45,212,160,0.2)',
  blue:'#4ba8f8',blueDim:'rgba(75,168,248,0.11)',blueMid:'rgba(75,168,248,0.22)',
  amber:'#f5a52a',amberDim:'rgba(245,165,42,0.1)',amberMid:'rgba(245,165,42,0.22)',
  red:'#f56868',redDim:'rgba(245,104,104,0.11)',redMid:'rgba(245,104,104,0.22)',
  t1:'#daeaf8',t2:'#6e90ab',t3:'#374f62',
  font:"'Outfit',system-ui,sans-serif",
  mono:"'DM Mono',monospace",
};

/* ─── CALENDAR CONSTANTS ─── */
const SH = 44;
const HRS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30'];
function tRow(t){const[h,m]=t.split(':').map(Number);return(h-8)*2+(m>=30?1:0);}

/* ─── CALENDAR DATA ─── */
const DAYS_DATA = [
  {d:'LUN',dt:'15',status:'holiday',lbl:'Feriado',blockUser:null,blockReason:null,count:2,appts:[
    {t:'11:30',n:'Silvia Ramírez', svc:'Licencia Conducir', svcS:'LIC',c:'b',op:'LM'},
    {t:'12:00',n:'Cristina López', svc:'Licencia Conducir', svcS:'LIC',c:'b',op:'ST'},
  ]},
  {d:'MAR',dt:'16',status:'blocked',lbl:'Bloqueado',blockUser:'Sofía Torres',blockReason:'Capacitación interna',count:3,appts:[
    {t:'09:30',n:'Matías González',svc:'Tribunal de Faltas',svcS:'TRI',c:'b',op:'CR'},
    {t:'11:00',n:'Andrea Suárez',  svc:'Licencia Conducir', svcS:'LIC',c:'g',op:'LM'},
    {t:'12:30',n:'Sandra Martín',  svc:'Licencia Conducir', svcS:'LIC',c:'b',op:'LM'},
  ]},
  {d:'MIÉ',dt:'17',status:'blocked',lbl:'Bloqueado',blockUser:'Torres · Ruiz',blockReason:'Reunión de equipo',count:3,appts:[
    {t:'09:00',n:'Pablo Castro',   svc:'Tribunal de Faltas',svcS:'TRI',c:'a',op:'LM'},
    {t:'10:30',n:'Nicolás Pérez',  svc:'Licencia Conducir', svcS:'LIC',c:'g',op:'LM'},
    {t:'13:00',n:'Carmen Vidal',   svc:'Tribunal de Faltas',svcS:'TRI',c:'b',op:'LM'},
  ]},
  {d:'JUE',dt:'18',status:'blocked',lbl:'Bloqueado',blockUser:'Sofía Torres',blockReason:'Licencia médica',count:3,appts:[
    {t:'10:00',n:'Fernanda Ríos',  svc:'Licencia Conducir', svcS:'LIC',c:'b',op:'LM'},
    {t:'11:30',n:'Tomás Herrera',  svc:'Tribunal de Faltas',svcS:'TRI',c:'g',op:'CR'},
    {t:'13:30',n:'Adriana Mora',   svc:'Licencia Conducir', svcS:'LIC',c:'r',op:'LM'},
  ]},
  {d:'VIE',dt:'19',status:'today',lbl:'Hoy',blockUser:null,blockReason:null,count:2,appts:[
    {t:'09:00',n:'Rosa Fuentes',   svc:'Licencia Conducir', svcS:'LIC',c:'b',op:'ST'},
    {t:'11:00',n:'Jorge Ibáñez',   svc:'Tribunal de Faltas',svcS:'TRI',c:'b',op:'CR'},
  ]},
  {d:'SÁB',dt:'20',status:'holiday',lbl:'Feriado',blockUser:null,blockReason:null,count:0,appts:[]},
  {d:'DOM',dt:'21',status:'closed', lbl:'Cerrado',blockUser:null,blockReason:null,count:0,appts:[]},
];

const APPT_C = {
  b:{bg:P.blueDim, ring:P.blueMid, tx:P.blue, dot:P.blue},
  g:{bg:P.tealDim, ring:P.tealMid, tx:P.teal, dot:P.teal},
  a:{bg:'rgba(45,212,160,0.07)',ring:'rgba(45,212,160,0.15)',tx:'#4fd4b2',dot:'#4fd4b2'},
  r:{bg:P.redDim,  ring:P.redMid,  tx:P.red,  dot:P.red},
};
const DAY_BG  = {holiday:'rgba(245,104,104,0.04)',blocked:'rgba(75,168,248,0.03)',today:'rgba(45,212,160,0.03)',closed:'rgba(0,0,0,0.12)',normal:'transparent'};
const DAY_HDR = {holiday:'rgba(245,104,104,0.09)',blocked:'rgba(75,168,248,0.07)',today:'rgba(45,212,160,0.07)',closed:'rgba(0,0,0,0.2)',normal:'transparent'};
function dayColor(s){return{holiday:P.red,today:P.teal,closed:P.t3,blocked:P.blue,normal:P.t2}[s]||P.t2;}

/* ─── ABM DATA ─── */
const USERS_DATA = [
  {i:'L',name:'Laura Montoya', email:'laura.m@vla.gob.ar',  role:'Encargado',    area:'Todas',    active:true},
  {i:'S',name:'Sofía Torres',  email:'sofia.t@vla.gob.ar',  role:'Operador',     area:'Licencias',active:true},
  {i:'C',name:'Carlos Ruiz',   email:'carlos.r@vla.gob.ar', role:'Operador',     area:'Tribunal', active:true},
  {i:'M',name:'Marcela Vega',  email:'marcela.v@vla.gob.ar',role:'Operador',     area:'Licencias',active:false},
  {i:'A',name:'Admin Sistema', email:'admin@vla.gob.ar',    role:'Administrador',area:'Todas',    active:true},
  {i:'P',name:'Patricia Ríos', email:'patricia.r@vla.gob.ar',role:'Operador',    area:'Licencias',active:true},
  {i:'R',name:'Roberto Díaz',  email:'roberto.d@vla.gob.ar',role:'Operador',     area:'Tribunal', active:false},
];
const SERVICES_DATA = [
  {name:'Licencia de Conducir 1ra vez',area:'Licencias',dur:'30 min',cap:'12/día',channels:'Online + Presencial',active:true},
  {name:'Renovación de Licencia',      area:'Licencias',dur:'20 min',cap:'18/día',channels:'Online + Presencial',active:true},
  {name:'Turno Tribunal de Faltas',    area:'Tribunal', dur:'45 min',cap:'8/día', channels:'Solo online',        active:true},
  {name:'Duplicado de Licencia',       area:'Licencias',dur:'15 min',cap:'20/día',channels:'Online + Presencial',active:true},
  {name:'Recurso de Acta',             area:'Tribunal', dur:'60 min',cap:'4/día', channels:'Solo presencial',    active:true},
  {name:'Consulta de Multas',          area:'Tribunal', dur:'20 min',cap:'10/día',channels:'Solo online',        active:false},
];
const AUDIT_DATA = [
  {type:'create',actor:'Laura Montoya', action:'Creó turno para Silvia Ramírez',          detail:'Lic. Conducir · Lun 15/06 · 11:30', time:'Hoy 11:25'},
  {type:'block', actor:'Sofía Torres',  action:'Bloqueó agenda — Mié 17/06',              detail:'Motivo: Reunión de equipo',          time:'Hoy 09:14'},
  {type:'delete',actor:'Admin Sistema', action:'Eliminó turno de Carlos Ruiz',            detail:'Lic. Conducir · Mar 09/06 · 10:00', time:'Ayer 16:48'},
  {type:'edit',  actor:'Laura Montoya', action:'Modificó turno de Matías González',       detail:'Horario: 09:00 → 09:30',            time:'Ayer 14:30'},
  {type:'create',actor:'Sofía Torres',  action:'Creó turno para Andrea Suárez',           detail:'Lic. Conducir · Mar 16/06 · 11:00', time:'Ayer 11:15'},
  {type:'block', actor:'Admin Sistema', action:'Marcó Lun 15/06 como Feriado',            detail:'Afecta todos los operadores',        time:'Ayer 09:02'},
  {type:'edit',  actor:'Admin Sistema', action:'Actualizó Licencia Conducir 1ra vez',     detail:'Capacidad: 10/día → 12/día',        time:'Anteayer 17:30'},
  {type:'create',actor:'Laura Montoya', action:'Creó turno para Sandra Martín',           detail:'Lic. Conducir · Mar 16/06 · 12:30', time:'Anteayer 12:45'},
  {type:'system',actor:'Sistema',       action:'Exportación de reporte mensual generada', detail:'Período: Mayo 2026 · 43 turnos',    time:'Hace 3 días'},
];
const A_COLOR = {create:P.teal,edit:P.blue,block:P.amber,delete:P.red,system:P.t2};
const A_LABEL = {create:'Alta',edit:'Edición',block:'Bloqueo',delete:'Baja',system:'Sistema'};
const ROLE_COLOR = {Encargado:P.teal,Operador:P.blue,Administrador:P.amber};

const NAV_ENC = [
  {label:'Calendario',items:['Agenda','Presencial','Bloqueos']},
  {label:'Reportes',  items:['Auditoría','Dashboard']},
  {label:'Admin.',    items:['Usuarios','Servicios']},
];
const NAV_OP = [{label:'Calendario',items:['Agenda','Presencial']}];

/* ─── HEATMAP DATA: 22 semanas × 5 días ─── */
const HM_DATA = (() => {
  const s = n => Math.abs(Math.sin(n * 9301 + 49297) * 233280) % 8;
  return Array.from({length:22}, (_, w) =>
    Array.from({length:5}, (_, d) => {
      if (w === 21) return [2,3,3,3,2][d];
      const mod = (d === 0 || d === 4) ? 0.6 : 1;
      return Math.floor(s(w * 7 + d) * mod);
    })
  );
})();

/* ─── NAV ICON ─── */
function NavIcon({name}){
  const paths = {
    Agenda:    'M2 3h12v10H2zM2 7.5h12M6 3V1M10 3V1',
    Presencial:'M4 3h8v7H4zM2 10h12M8 10v3.5M6 13.5h4',
    Bloqueos:  'M5 7V5a3 3 0 016 0v2M4 7h8v7H4zM8 10.5v2',
    Auditoría: 'M5 1h6v2H5zM3 2h10v12H3zM6 7h4M6 10h3',
    Dashboard: 'M2 13h2V8H2zM7 13h2V5H7zM12 13h2V2h-2zM1 14h14',
    Usuarios:  'M5.5 6a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1 14a4.5 4.5 0 019 0M11 4a2 2 0 110 4M15 14a3 3 0 00-3-3',
    Servicios: 'M1 1h5v5H1zM9 1h6v5H9zM1 9h5v6H1zM9 9h6v6H9z',
  };
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
      <path d={paths[name]||''}/>
    </svg>
  );
}

/* ─── MINI CALENDAR ─── */
function MiniCalendar(){
  const weeks = [[1,2,3,4,5,6,7],[8,9,10,11,12,13,14],[15,16,17,18,19,20,21],[22,23,24,25,26,27,28],[29,30,null,null,null,null,null]];
  return (
    <div style={{padding:'10px 14px 8px',borderBottom:`1px solid ${P.bdr}`}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:7}}>
        <span style={{fontSize:11,fontWeight:700,color:P.t1,fontFamily:P.font}}>Junio 2026</span>
        <div style={{display:'flex',gap:2}}>
          {['‹','›'].map(a=>(
            <div key={a} style={{width:18,height:18,borderRadius:3,border:`1px solid ${P.bdr}`,display:'flex',alignItems:'center',justifyContent:'center',color:P.t3,fontSize:12,cursor:'pointer'}}>{a}</div>
          ))}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',rowGap:'2px'}}>
        {['L','M','X','J','V','S','D'].map(d=>(
          <div key={d} style={{textAlign:'center',fontSize:8.5,color:P.t3,fontWeight:700,paddingBottom:3}}>{d}</div>
        ))}
        {weeks.flat().map((day,i)=>{
          const inW = day>=15&&day<=21, isT = day===19;
          return (
            <div key={i} style={{textAlign:'center',fontSize:10,padding:'2.5px 0',borderRadius:3,background:isT?P.teal:inW?P.tealDim:'transparent',color:isT?P.bg0:inW?P.teal:day?P.t2:'transparent',fontWeight:(isT||inW)?700:400,cursor:day?'pointer':'default',fontFamily:P.mono}}>
              {day||''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── SIDEBAR ─── */
function Sidebar({active, role='enc'}){
  const groups = role==='op' ? NAV_OP : NAV_ENC;
  const u = role==='op'
    ? {i:'S',name:'Sofía Torres', roleLabel:'Operador',  color:P.blue}
    : {i:'L',name:'Laura Montoya',roleLabel:'Encargado', color:P.teal};
  return (
    <div style={{width:220,background:P.bg1,borderRight:`1px solid ${P.bdr}`,display:'flex',flexDirection:'column',flexShrink:0,fontFamily:P.font}}>
      <div style={{padding:'14px 14px 12px',borderBottom:`1px solid ${P.bdr}`}}>
        <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:11}}>
          <div style={{width:36,height:36,borderRadius:8,background:P.tealDim,border:`1px solid ${P.tealMid}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <span style={{color:P.teal,fontSize:10.5,fontWeight:800,letterSpacing:'-0.5px'}}>VLA</span>
          </div>
          <div>
            <div style={{fontSize:8.5,color:P.t3,textTransform:'uppercase',letterSpacing:'0.11em',fontWeight:700}}>Municipalidad</div>
            <div style={{fontSize:12.5,fontWeight:700,color:P.t1,lineHeight:1.2}}>Villa La Angostura</div>
          </div>
        </div>
        <div style={{padding:'7px 9px',background:`${u.color}0f`,border:`1px solid ${u.color}22`,borderRadius:7,display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:28,height:28,borderRadius:14,background:`${u.color}25`,display:'flex',alignItems:'center',justifyContent:'center',color:u.color,fontSize:13,fontWeight:700,flexShrink:0}}>{u.i}</div>
          <div>
            <div style={{fontSize:11.5,fontWeight:600,color:P.t1,lineHeight:1.2}}>{u.name}</div>
            <div style={{fontSize:10,color:u.color,fontWeight:600}}>{u.roleLabel}</div>
          </div>
        </div>
      </div>
      <MiniCalendar/>
      <nav style={{flex:1,padding:'6px 8px',overflowY:'auto'}}>
        {groups.map(g=>(
          <div key={g.label} style={{marginBottom:3}}>
            <div style={{padding:'8px 8px 3px',fontSize:8.5,color:P.t3,textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:700}}>{g.label}</div>
            {g.items.map(item=>{
              const on = item===active;
              return (
                <div key={item} style={{padding:'6px 10px',borderRadius:5,display:'flex',alignItems:'center',gap:8,background:on?P.tealDim:'transparent',borderLeft:`2px solid ${on?P.teal:'transparent'}`,cursor:'pointer',marginBottom:1,color:on?P.teal:P.t2}}>
                  <NavIcon name={item}/>
                  <span style={{fontSize:12.5,fontWeight:on?600:400}}>{item}</span>
                  {on&&<div style={{marginLeft:'auto',width:5,height:5,borderRadius:3,background:P.teal}}/>}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{padding:'10px 12px',borderTop:`1px solid ${P.bdr}`}}>
        <div style={{padding:'5px',borderRadius:5,border:`1px solid ${P.bdr}`,textAlign:'center',fontSize:11.5,color:P.t3,cursor:'pointer'}}>Cerrar sesión</div>
      </div>
    </div>
  );
}

/* ─── CHARTS ─── */
function DonutChart({data,size=148}){
  const total = data.reduce((s,d)=>s+d.v,0);
  const R=50,SW=18,cx=size/2,cy=size/2;
  let sa = -Math.PI/2;
  function arc(a1,a2){
    const x1=cx+R*Math.cos(a1),y1=cy+R*Math.sin(a1),x2=cx+R*Math.cos(a2),y2=cy+R*Math.sin(a2);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${(a2-a1)>Math.PI?1:0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={P.bdr} strokeWidth={SW}/>
      {data.map((d,i)=>{
        const angle=(d.v/total)*2*Math.PI,ea=sa+angle,gap=angle>0.15?0.06:0;
        const p=arc(sa+gap,ea-gap); sa=ea;
        return <path key={i} d={p} fill="none" stroke={d.color} strokeWidth={SW} strokeLinecap="butt"/>;
      })}
      <text x={cx} y={cy+8}  textAnchor="middle" fontSize="24" fontWeight="800" fill={P.t1} fontFamily={P.mono}>{total}</text>
      <text x={cx} y={cy+22} textAnchor="middle" fontSize="10" fill={P.t2} fontFamily={P.font}>turnos</text>
    </svg>
  );
}

function BarChartSVG({data}){
  const max=Math.max(...data.map(d=>d.v),1),n=data.length,bw=42,gap=12,ph=90,w=n*(bw+gap)-gap;
  return (
    <svg width="100%" height="115" viewBox={`0 0 ${w} 115`} preserveAspectRatio="xMidYMid meet" style={{display:'block'}}>
      <line x1={0} y1={ph} x2={w} y2={ph} stroke={P.bdr} strokeWidth={1}/>
      {data.map((d,i)=>{
        const bh=Math.max(3,(d.v/max)*ph),x=i*(bw+gap),y=ph-bh;
        return (
          <g key={d.l}>
            <rect x={x} y={y} width={bw} height={bh} rx={4} fill={d.hi?P.teal:'rgba(45,212,160,0.2)'}/>
            <text x={x+bw/2} y={ph+14} textAnchor="middle" fontSize="11" fill={P.t2} fontFamily={P.font}>{d.l}</text>
            {d.v>0&&<text x={x+bw/2} y={y-6} textAnchor="middle" fontSize="11" fontWeight="700" fill={d.hi?P.teal:P.t2} fontFamily={P.mono}>{d.v}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SparkLine({data,color,w=72,h=34}){
  const max=Math.max(...data),min=Math.min(...data),rng=max-min||1;
  const pts=data.map((v,i)=>[(i/(data.length-1))*w,h-4-((v-min)/rng)*(h-8)]);
  const d=pts.map((p,i)=>`${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{overflow:'visible'}}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.8" fill={color}/>
    </svg>
  );
}

/* ─── HEATMAP CALENDAR ─── */
function HeatmapCalendar(){
  const cs=13, gap=2;
  const hColor = v => {
    if(v===0) return P.bg4;
    if(v<=2)  return 'rgba(45,212,160,0.22)';
    if(v<=5)  return 'rgba(45,212,160,0.58)';
    return P.teal;
  };
  const ML = [{l:'Ene',w:0},{l:'Feb',w:4},{l:'Mar',w:8},{l:'Abr',w:12},{l:'May',w:16},{l:'Jun',w:20}];
  return (
    <div style={{padding:'16px',background:P.bg3,border:`1px solid ${P.bdr}`,borderRadius:7}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:13,fontWeight:700,color:P.t1,fontFamily:P.font}}>Actividad · 22 semanas</span>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{fontSize:9.5,color:P.t3,fontFamily:P.font}}>Menor</span>
          {[P.bg4,'rgba(45,212,160,0.22)','rgba(45,212,160,0.58)',P.teal].map((c,i)=>(
            <div key={i} style={{width:12,height:12,borderRadius:2,background:c}}/>
          ))}
          <span style={{fontSize:9.5,color:P.t3,fontFamily:P.font}}>Mayor</span>
        </div>
      </div>
      <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
        <div style={{display:'flex',flexDirection:'column',gap:`${gap}px`,paddingTop:20,marginRight:2}}>
          {['L','M','X','J','V'].map(d=>(
            <div key={d} style={{height:cs,lineHeight:`${cs}px`,fontSize:8.5,color:P.t3,fontWeight:600,fontFamily:P.font}}>{d}</div>
          ))}
        </div>
        <div>
          <div style={{position:'relative',height:18,marginBottom:4}}>
            {ML.map(({l,w})=>(
              <div key={l} style={{position:'absolute',left:w*(cs+gap),fontSize:9,color:P.t3,fontFamily:P.font,fontWeight:600}}>{l}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateRows:`repeat(5,${cs}px)`,gridAutoFlow:'column',gridAutoColumns:`${cs}px`,gap:`${gap}px`}}>
            {HM_DATA.map((week,w)=>week.map((v,d)=>(
              <div key={`${w}-${d}`} style={{borderRadius:2,background:hColor(v),outline:w===21?`1.5px solid rgba(45,212,160,0.45)`:'none',outlineOffset:'1px'}} title={`${v} turnos`}/>
            )))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── EXPORTS ─── */
Object.assign(window, {
  P,SH,HRS,tRow,
  DAYS_DATA,APPT_C,DAY_BG,DAY_HDR,dayColor,
  USERS_DATA,SERVICES_DATA,AUDIT_DATA,A_COLOR,A_LABEL,ROLE_COLOR,
  HM_DATA,NAV_ENC,NAV_OP,
  NavIcon,MiniCalendar,Sidebar,
  DonutChart,BarChartSVG,SparkLine,HeatmapCalendar,
});
