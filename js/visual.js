// 映像エンジン: WebGL2 / GPUパーティクル(transform feedback) + 残像 + ブルーム + 生成背景

const COMMON = `
float hash11(float n){return fract(sin(n)*43758.5453123);}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec3 moodPal(float t,float val,float hue){
  t+=hue;
  vec3 warm=vec3(.55,.45,.40)+vec3(.45,.40,.45)*cos(6.2831*(t+vec3(.02,.17,.42)));
  vec3 mid =vec3(.35,.50,.60)+vec3(.35,.40,.40)*cos(6.2831*(t+vec3(.55,.30,.10)));
  vec3 cold=vec3(.30,.18,.50)+vec3(.30,.18,.45)*cos(6.2831*(t*.8+vec3(.85,.60,.25)));
  vec3 c=mix(mid,warm,smoothstep(0.,.8,val));
  c=mix(c,cold,smoothstep(0.,.8,-val));
  return max(c,vec3(0.));
}
`;

const VS_TRI = `#version 300 es
out vec2 v_uv;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2))*2.-1.;
  v_uv=p*.5+.5; gl_Position=vec4(p,0.,1.);
}`;

const VS_SIM = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_pos;
layout(location=1) in vec4 a_vel;
out vec4 v_pos; out vec4 v_vel;
uniform float u_t,u_dt,u_vol,u_val,u_energy,u_shockT,u_climax,u_rayF,u_waveF,u_flower,u_lift;
uniform vec3 u_gaze,u_shockP;
uniform vec2 u_ext,u_wind;
uniform vec4 u_orb[7],u_hand;
uniform highp sampler2D u_tgt0,u_tgt1; uniform float u_tgtA,u_tgtB; uniform vec3 u_tgtBoff;
${COMMON}
vec3 hash3(float n){return vec3(hash11(n),hash11(n+17.13),hash11(n+41.7));}
vec3 flow(vec3 p,float t){
  return vec3(sin(p.y*1.3+t)+sin(p.z*1.7-t*.7),
              sin(p.z*1.1+t*.8)+sin(p.x*1.9+t*.3),
              sin(p.x*1.5-t*.5)+sin(p.y*1.2+t*.6));
}
void main(){
  vec3 p=a_pos.xyz; float life=a_pos.w; vec3 v=a_vel.xyz; float seed=a_vel.w;
  float fs=mix(1.,1.9,max(-u_val,0.));
  vec3 f=flow(p*fs+seed*.6,u_t*.35)*(.30+u_energy*.8);
  f.y+=u_val*.35;
  vec3 d=u_gaze-p; float r=length(d)+1e-3; vec3 dn=d/r;
  float att=1.5/(.22+r*r);
  f+=dn*att*(.55-u_vol*2.4);
  f+=cross(dn,vec3(0.,0.,1.))*att*.95;
  for(int i=0;i<7;i++){
    vec3 od=u_orb[i].xyz-p; float orr=length(od)+1e-3; float a=u_orb[i].w; vec3 on=od/orr;
    f+=on*a*.45/(.12+orr*orr)+cross(on,vec3(0.,0.,1.))*a*.7/(.18+orr*orr);
  }
  vec3 hd=u_hand.xyz-p; float hr=length(hd)+1e-3;
  f+=hd/hr*u_hand.w*2.4/(.14+hr*hr)+cross(hd/hr,vec3(0.,0.,1.))*abs(u_hand.w)*.8/(.2+hr*hr);
  f.xy+=u_wind*(.6+.8*hash11(seed*13.1));
  // 風: はためき
  f.y+=sin(p.x*3.+u_t*7.+seed*6.)*length(u_wind)*.55;
  // 光: 視線の先から一気に吹き飛ばす
  vec3 rdv=p-u_gaze; f+=rdv/(length(rdv)+.05)*u_rayF*7.;
  // 波: うねりに乗って上下する
  f.y+=sin(p.x*2.6-u_t*5.)*u_waveF*3.4; f.x+=cos(p.x*2.6-u_t*5.)*u_waveF*.9;
  // 朝は立ちのぼり、夜は沈む
  f.y+=u_lift;
  // 花: 五弁の花の輪郭に粒が集まる
  float flr=length(p.xy)+1e-3, fla=atan(p.y,p.x)+u_t*.15;
  float flt=(.16+.9*abs(cos(2.5*fla)))*1.05;
  f=mix(f,vec3(0.),u_flower*.6); f.xy+=(p.xy/flr)*(flt-flr)*u_flower*26.; f.z-=p.z*u_flower*3.;
  // 波: 粒が何本ものうねる糸になる
  float wsh=.2*sin(p.x*2.4-u_t*3.2)+.07*sin(p.x*5.1+u_t*2.);
  float wty=(floor((p.y-wsh)/.42+.5))*.42+wsh;
  f.y+=(wty-p.y)*u_waveF*22.; f.z-=p.z*u_waveF*4.;
  // 文字や太陽・月: 一部の粒が、決められた点へ集まって形をつくる
  int ti=int(hash11(seed*977.3)*4095.99);
  float hold=0.;
  if(seed<.30&&u_tgtA>.001){
    vec3 tg=texelFetch(u_tgt0,ivec2(ti&63,ti>>6),0).xyz;
    f=mix(f,vec3(0.),u_tgtA*.85)+(tg-p)*u_tgtA*22.; hold=u_tgtA*7.;
  }else if(seed>=.30&&seed<.50&&u_tgtB>.001){
    vec3 tg=texelFetch(u_tgt1,ivec2(ti&63,ti>>6),0).xyz+u_tgtBoff;
    f=mix(f,vec3(0.),u_tgtB*.7)+(tg-p)*u_tgtB*14.; hold=u_tgtB*5.;
  }
  vec3 sd=p-u_shockP; float sl=length(sd)+1e-3;
  float ring=exp(-pow((sl-u_shockT*2.4)*5.,2.))*exp(-u_shockT*1.6);
  f+=sd/sl*ring*16.;
  f-=p*smoothstep(1.5,2.8,length(p/vec3(u_ext.x/1.5,1.,1.)))*1.6;
  f.z-=p.z*.8;
  v+=f*u_dt; v*=exp(-u_dt*(1.7+hold));
  p+=v*u_dt;
  life-=u_dt*(.10+hash11(seed*91.7)*.22)*(1.+u_climax)*(1.-min(hold*.2,.9));
  if(life<0.){
    vec3 h=hash3(seed*713.3+fract(u_t*.37)*91.);
    float sel=hash11(seed*31.7+u_t*3.1);
    vec3 dir=normalize(h*2.-1.+1e-4);
    if(sel<u_vol*.85+.05){ p=u_gaze+dir*.04; v=dir*(.4+u_vol*2.6); }
    else if(sel>.82&&abs(u_hand.w)>.25){ p=u_hand.xyz+dir*.05; v=dir*(.3+max(-u_hand.w,0.)*2.2); }
    else{
      int oi=int(h.x*6.999);
      vec4 o=u_orb[oi];
      if(o.w>.5&&sel<.62){ p=o.xyz+dir*.03; v=dir*.55; }
      else{ p=(h*2.-1.)*vec3(u_ext.x,u_ext.y,.9); v=dir*.05; }
    }
    life=1.;
  }
  v_pos=vec4(p,life); v_vel=vec4(v,seed);
}`;

const FS_NULL = `#version 300 es
precision mediump float; out vec4 o; void main(){o=vec4(0.);}`;

const VS_PART = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_pos;
layout(location=1) in vec4 a_vel;
uniform mat4 u_vp; uniform float u_px,u_val,u_hue,u_energy,u_climax,u_tgtA,u_tgtB; uniform vec3 u_tgtBcol;
out vec3 v_col;
${COMMON}
void main(){
  vec4 c=u_vp*vec4(a_pos.xyz,1.); gl_Position=c;
  float seed=a_vel.w; float sp=length(a_vel.xyz);
  float fade=smoothstep(0.,.12,a_pos.w)*smoothstep(1.,.9,a_pos.w);
  float h=hash11(seed*57.3);
  gl_PointSize=max(1.,u_px*(.55+1.5*h*h)*(1.+u_energy*.35)/max(c.w,.3));
  float t=(seed-.5)*.36+sp*.10;
  v_col=moodPal(t,u_val,u_hue)*(.055+sp*.10)*(1.+u_energy*.9+u_climax*.3)*fade;
  v_col+=vec3(.12)*step(.985,h)*fade*(1.+u_climax*1.);
  if(seed<.30) v_col=mix(v_col,vec3(.9,.93,1.)*(.03+.05*step(.9,h))*fade,u_tgtA);
  else if(seed<.50) v_col=mix(v_col,u_tgtBcol*(.02+.04*step(.9,h))*fade,u_tgtB);
}`;

const FS_PART = `#version 300 es
precision highp float; in vec3 v_col; out vec4 o;
void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.0,d); o=vec4(v_col*a*a,1.); }`;

const FS_TRAIL = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D u_prev; uniform vec2 u_g; uniform float u_decay,u_zoom,u_rot,u_asp;
void main(){
  vec2 d=v_uv-u_g; d.x*=u_asp;
  float c=cos(u_rot),s=sin(u_rot); d=mat2(c,-s,s,c)*d; d.x/=u_asp;
  o=vec4(texture(u_prev,u_g+d*(1.-u_zoom)).rgb*u_decay,1.);
}`;

const VS_LINE = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_p; uniform mat4 u_vp; uniform vec3 u_off;
void main(){ gl_Position=u_vp*vec4(a_p+u_off,1.); gl_PointSize=2.; }`;

const FS_LINE = `#version 300 es
precision highp float; uniform vec3 u_c; out vec4 o; void main(){o=vec4(u_c,1.);}`;

const FS_BLUR = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_dir;
void main(){
  vec3 c=texture(u_tex,v_uv).rgb*.227027;
  c+=(texture(u_tex,v_uv+u_dir*1.3846).rgb+texture(u_tex,v_uv-u_dir*1.3846).rgb)*.316216;
  c+=(texture(u_tex,v_uv+u_dir*3.2308).rgb+texture(u_tex,v_uv-u_dir*3.2308).rgb)*.070270;
  o=vec4(c,1.);
}`;

const FS_COMP = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D u_acc,u_blm;
uniform vec2 u_res,u_gz,u_rayP; uniform vec3 u_hd,u_sun,u_wk; uniform vec4 u_met;
uniform float u_rayA,u_waveA,u_flowerA,u_night,u_metT,u_starB; uniform vec2 u_windS;
uniform float u_t,u_val,u_hue,u_vol,u_flash,u_climax,u_beat,u_bright,u_gzOn,u_orbOn;
uniform vec4 u_orb[7]; uniform float u_orbD[7]; uniform int u_link;
uniform float u_hist[48]; uniform float u_histA[48];
uniform vec3 u_shock;
${COMMON}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+17.1;a*=.5;}return s;}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.,1.);return length(pa-ba*h);}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float asp=u_res.x/u_res.y;
  // 波: 画面全体が水面のようにゆらぐ
  float wv=(sin(p.x*13.-u_t*5.)*.006+sin(p.x*6.+u_t*3.)*.004)*u_waveA;
  p.y+=wv; vec2 uvw=v_uv+vec2(0.,wv);
  float hue=u_hue+u_climax*u_t*.08;
  // 星雲
  vec2 q=p*1.4; float tt=u_t*.03;
  vec2 w=vec2(fbm(q*1.2+vec2(tt,-tt)),fbm(q*1.2+vec2(5.2-tt,1.3+tt)));
  float n=fbm(q+w*1.6+u_hue*3.);
  vec3 bg=moodPal(n*.5-.15+w.x*.2,u_val,hue)*pow(n,2.3)*(.55+u_beat*.35+u_climax*.35);
  // 星
  vec2 sg=p*90.; float sh=h21(floor(sg));
  bg+=vec3(step(.985,sh)*smoothstep(.35,0.,length(fract(sg)-.5))*(.5+.5*sin(u_t*(1.+sh*5.)+sh*50.)))*.45*(1.+u_starB*5.);
  // 視線の灯り
  float gd=length(p-u_gz);
  bg+=moodPal(.05,u_val,hue)*(.012/(.01+gd*gd*3.))*u_gzOn*.22;
  // 声のオーロラ
  float hx=abs(v_uv.x-.5)*2.*47.; int i0=int(floor(hx)); int i1=min(i0+1,47); float hf=fract(hx);
  float ry=mix(u_hist[i0],u_hist[i1],hf); float ra=mix(u_histA[i0],u_histA[i1],hf);
  float curt=fbm(vec2(p.x*9.+u_t*.4,u_t*.2));
  float dy=p.y-ry*.36-(curt-.5)*.03;
  float aur=ra*(.0028/(abs(dy)+.005)+.16*exp(-abs(dy)*22.)+.6*exp(-max(dy,0.)*5.)*exp(-max(-dy,0.)*30.)*curt*curt*2.);
  vec3 fx=moodPal(.2+ry*.25+u_bright*.3,u_val,hue)*aur;
  // 輪と星座
  for(int i=0;i<7;i++){
    vec4 ob=u_orb[i]; vec2 d=p-ob.xy; float r=length(d);
    vec3 oc=moodPal(float(i)/7.*.5-.25,u_val,hue+.1);
    float br=.5+.5*sin(u_t*1.7+float(i)*1.3);
    float sl=(1.-ob.z)*u_orbOn;
    fx+=oc*sl*(smoothstep(.0035,0.,abs(r-.026-.003*br))*.55+.00035/(r*r+.0004)*(.4+.4*br));
    float ang=atan(d.x,d.y)/6.2831+.5;
    fx+=vec3(1.)*sl*step(ang,u_orbD[i])*step(.001,u_orbD[i])*smoothstep(.004,0.,abs(r-.042));
    float ray=exp(-abs(d.x)*140.)*exp(-abs(d.y)*9.)+exp(-abs(d.y)*140.)*exp(-abs(d.x)*9.);
    fx+=oc*ob.z*(.0011/(r*r+.0005)*(1.+ob.w*2.5)+ray*(.45+ob.w*1.5)+smoothstep(.004,0.,abs(r-.03-ob.w*.05))*ob.w);
    vec4 o2=u_orb[(i+u_link)%7];
    float ld=seg(p,ob.xy,o2.xy);
    fx+=mix(oc,vec3(1.),.4)*min(ob.z,o2.z)*(.0008/(ld+.0015))*(.6+.4*sin(u_t*2.+ld*80.));
  }
  // 視線カーソル
  fx+=vec3(smoothstep(.0025,0.,abs(gd-.03))*.32+smoothstep(.006,0.,gd)*.6)*u_gzOn;
  // 手の灯り
  float hdd=length(p-u_hd.xy);
  fx+=moodPal(.3,u_val,hue)*.0007/(hdd*hdd+.002)*u_hd.z;
  // 波紋
  float sd=length(p-u_shock.xy);
  fx+=moodPal(.1,u_val,hue)*smoothstep(.02,0.,abs(sd-u_shock.z*1.1))*exp(-u_shock.z*2.2)*1.3;
  // 光: 視線の先から放射する光条
  vec2 rv=p-u_rayP; float rl=length(rv); vec2 rn=rv/(rl+1e-4);
  float rays=pow(vn(rn*9.+u_t*.35)*vn(rn*27.-u_t*.6),2.)*5.;
  fx+=vec3(1.,.93,.75)*u_rayA*(rays*(.12+.3/(rl*4.+.4))+.02/(rl*rl+.02));
  // 風: 横に走る細い筋
  float wl=length(u_windS), wsg=u_windS.x<0.?-1.:1.;
  float stv=smoothstep(.7,.95,vn(vec2(p.x*2.5-wsg*u_t*11.,p.y*420.)))*vn(vec2(p.x*1.3-wsg*u_t*6.,p.y*7.));
  fx+=vec3(.8,.95,1.)*stv*min(wl*.16,.4);
  // 波: 水面の光の帯
  float band=pow(.5+.5*sin(p.y*46.+sin(p.x*7.+u_t*2.5)*2.5-u_t*5.),10.);
  fx+=vec3(.25,.6,1.)*band*u_waveA*.05;
  // 花: 五弁の花
  vec2 fp=p-u_wk.xy; float fa=atan(fp.y,fp.x)+u_t*.15, fr=length(fp);
  float ft=(.16+.9*abs(cos(2.5*fa)))*1.05*u_wk.z;
  fx+=vec3(1.,.45,.7)*u_flowerA*(.10*smoothstep(ft,0.,fr)*(.5+.5*cos(5.*fa))+.003/(fr*fr+.004));
  // 朝・夕: 地平から昇る／沈む太陽
  vec2 sv=p-vec2(0.,mix(-.7,.16,u_sun.x)); float sl2=length(sv);
  vec3 sc=u_sun.z>0.?vec3(1.,.82,.5):vec3(1.,.34,.14);
  fx+=sc*u_sun.y*(.012/(sl2*sl2+.03)+exp(-(p.y+.5)*3.2)*(u_sun.z>0.?.3:.42));
  // 星: 流れ星
  vec2 mdr=normalize(u_met.zw-u_met.xy+1e-5); vec2 mh=mix(u_met.xy,u_met.zw,clamp(u_metT/.55,0.,1.));
  float mds=seg(p,mh,mh-mdr*.3*smoothstep(0.,.2,u_metT));
  fx+=vec3(.85,.93,1.)*smoothstep(1.,.5,u_metT)*(.0009/(mds+.0009));
  // 合成
  vec2 dir=v_uv-.5; float ca=.0012+.006*u_vol+.004*u_flash;
  vec3 acc=vec3(texture(u_acc,uvw-dir*ca).r,texture(u_acc,uvw).g,texture(u_acc,uvw+dir*ca).b);
  vec3 bl=texture(u_blm,uvw).rgb;
  vec3 col=bg+fx+acc+bl*(.9+u_climax*.25)+u_flash*.05;
  // 夜: 全体が暗く沈み、月と満天の星が出る
  col*=mix(1.,.42,u_night);
  vec2 ng=p*210.; float nh=hash11(dot(floor(ng),vec2(127.1,311.7)));
  float nst=step(.972,nh)*smoothstep(.12+.2*fract(nh*57.),0.,length(fract(ng)-.5))*(.5+.5*sin(u_t*(1.5+fract(nh*91.)*3.)+nh*400.));
  vec2 mp=p-vec2(asp*.5-.24,.29); float md=length(mp);
  float moon=smoothstep(.064,.06,md)*smoothstep(.05,.058,length(mp-vec2(.026,.012)));
  col+=(vec3(.85,.9,1.)*(moon*0.+.0025/(md*md+.012))+vec3(nst)*.9)*u_night;
  col=1.-exp(-col*(1.05+u_climax*.05));
  col=pow(col,vec3(.4545));
  col=mix(col,col*col*(3.-2.*col),.35);
  col*=1.-dot(dir,dir)*.85;
  col+=(h21(gl_FragCoord.xy+fract(u_t)*100.)-.5)*.025;
  o=vec4(col,1.);
}`;

export class Visual {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.N = 1 << 17;
    this.drawN = this.N;
    this.scale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.F = 1 / Math.tan(25 * Math.PI / 180);
    this.cam = { x: 0, y: 0, z: 3.2 };
    this.restZ = 3.2;
    this.faceOn = true;
    this._perf = { acc: 0, n: 0 };

    this.pSim = this._prog(VS_SIM, FS_NULL, ['v_pos', 'v_vel']);
    this.pPart = this._prog(VS_PART, FS_PART);
    this.pTrail = this._prog(VS_TRI, FS_TRAIL);
    this.pBlur = this._prog(VS_TRI, FS_BLUR);
    this.pComp = this._prog(VS_TRI, FS_COMP);
    this.pLine = this._prog(VS_LINE, FS_LINE);

    // パーティクル
    const data = new Float32Array(this.N * 8);
    for (let i = 0; i < this.N; i++) {
      const o = i * 8;
      data[o] = (Math.random() * 2 - 1) * 2.4; data[o + 1] = (Math.random() * 2 - 1) * 1.5; data[o + 2] = (Math.random() * 2 - 1) * .9;
      data[o + 3] = Math.random();
      data[o + 7] = Math.random();
    }
    this.buf = [gl.createBuffer(), gl.createBuffer()];
    this.vao = [gl.createVertexArray(), gl.createVertexArray()];
    for (let k = 0; k < 2; k++) {
      gl.bindVertexArray(this.vao[k]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[k]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    }
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.cur = 0;
    this.tf = gl.createTransformFeedback();
    this.vaoTri = gl.createVertexArray();

    // 顔メッシュ
    this.faceVao = gl.createVertexArray();
    this.faceBuf = gl.createBuffer();
    this.faceIdx = gl.createBuffer();
    this.faceIdxN = 0;
    gl.bindVertexArray(this.faceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 478 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 手: 顔と同じく、細い線を折り重ねた網で描く(頂点は毎フレーム更新)
    this.handVao = gl.createVertexArray(); this.handBuf = gl.createBuffer(); this.handIdx = gl.createBuffer(); this.handIdxN = 0;

    // 粒が集まる目標点(64×64=4096点)。0: 文字, 1: 太陽や月
    this.tgtTex = [0, 1].map(() => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 64, 0, gl.RGBA, gl.FLOAT, new Float32Array(64 * 64 * 4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    this.orbW = new Float32Array(28); this.orbS = new Float32Array(28); this.orbD = new Float32Array(7);
    this.vp = new Float32Array(16);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _prog(vs, fs, tfv) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    if (tfv) gl.transformFeedbackVaryings(p, tfv, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: n => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
  }

  _fbo(w, h) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  resize() {
    const gl = this.gl, c = this.canvas;
    const W = Math.max(2, Math.floor(window.innerWidth * this.scale)), H = Math.max(2, Math.floor(window.innerHeight * this.scale));
    if (W === this.W && H === this.H) return;
    c.width = this.W = W; c.height = this.H = H;
    this.aspect = W / H;
    for (const f of this.fbos || []) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); }
    this.acc = [this._fbo(W, H), this._fbo(W, H)];
    this.half = this._fbo(W >> 1 || 1, H >> 1 || 1);
    this.q = [this._fbo(W >> 2 || 1, H >> 2 || 1), this._fbo(W >> 2 || 1, H >> 2 || 1)];
    this.fbos = [...this.acc, this.half, ...this.q];
    this.accCur = 0;
  }

  halfH() { return this.restZ / this.F; }
  project(x, y) { const k = .5 * this.F / this.cam.z; return { x: (x - this.cam.x) * k, y: (y - this.cam.y) * k }; }
  unproject(px, py) { const k = 2 * this.cam.z / this.F; return { x: this.cam.x + px * k, y: this.cam.y + py * k }; }

  setFaceTopology(pairs) {
    const gl = this.gl;
    const idx = new Uint16Array(pairs.length * 2);
    pairs.forEach((c, i) => { idx[i * 2] = c.start; idx[i * 2 + 1] = c.end; });
    gl.bindVertexArray(this.faceVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.faceIdxN = idx.length;
  }

  // pts: Float32Array(4096*4) のワールド座標 (x,y,z,未使用)
  setTargets(slot, pts) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tgtTex[slot]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.FLOAT, pts);
  }

  setHandMesh(indices, vertCount) {
    const gl = this.gl;
    gl.bindVertexArray(this.handVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.handBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vertCount * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.handIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.handIdxN = indices.length;
  }

  _vp() {
    const m = this.vp, F = this.F, a = this.aspect, n = .1, f = 20, c = this.cam;
    const A = (f + n) / (n - f), B = 2 * f * n / (n - f);
    m.fill(0);
    m[0] = F / a; m[5] = F; m[10] = A; m[11] = -1;
    m[12] = -c.x * F / a; m[13] = -c.y * F; m[14] = -c.z * A + B; m[15] = c.z;
  }

  frame(u) {
    const gl = this.gl, dt = u.dt;
    // 負荷に応じて品質を落とす
    if (dt < .2 && !document.hidden) {
      const pf = this._perf; pf.acc += dt; pf.n++;
      if (pf.n >= 150) {
        const avg = pf.acc / pf.n; pf.acc = 0; pf.n = 0;
        if (avg > 1 / 38) {
          if (this.scale > 1) { this.scale = 1; this.resize(); }
          else if (this.drawN > 32768) this.drawN >>= 1;
        }
      }
    }
    this._vp();
    const gw = this.unproject(u.gaze.x, u.gaze.y);
    const ext = [this.halfH() * this.aspect * 1.05, this.halfH() * 1.05];
    for (let i = 0; i < 7; i++) {
      const o = u.orbs[i], s = this.project(o.wx, o.wy);
      this.orbW[i * 4] = o.wx; this.orbW[i * 4 + 1] = o.wy; this.orbW[i * 4 + 2] = 0; this.orbW[i * 4 + 3] = o.awake;
      this.orbS[i * 4] = s.x; this.orbS[i * 4 + 1] = s.y; this.orbS[i * 4 + 2] = o.awake; this.orbS[i * 4 + 3] = o.pulse;
      this.orbD[i] = o.dwell;
    }

    // 1) シミュレーション
    const S = this.pSim, src = this.cur, dst = 1 - src;
    gl.useProgram(S.p);
    gl.uniform1f(S.u('u_t'), u.t); gl.uniform1f(S.u('u_dt'), dt);
    gl.uniform1f(S.u('u_vol'), u.vol); gl.uniform1f(S.u('u_val'), u.val); gl.uniform1f(S.u('u_energy'), u.energy);
    gl.uniform1f(S.u('u_shockT'), u.shock.t); gl.uniform1f(S.u('u_climax'), u.climax);
    gl.uniform3f(S.u('u_gaze'), gw.x, gw.y, 0); gl.uniform3f(S.u('u_shockP'), u.shock.x, u.shock.y, 0);
    gl.uniform2f(S.u('u_ext'), ext[0], ext[1]);
    gl.uniform4fv(S.u('u_orb'), this.orbW);
    gl.uniform4f(S.u('u_hand'), u.hand.x, u.hand.y, 0, u.hand.w);
    gl.uniform2f(S.u('u_wind'), u.wind.x, u.wind.y);
    const X = u.fx;
    gl.uniform1f(S.u('u_rayF'), X.rayF); gl.uniform1f(S.u('u_waveF'), X.waveA * .6);
    gl.uniform1f(S.u('u_flower'), X.flower); gl.uniform1f(S.u('u_lift'), X.lift);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tgtTex[0]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.tgtTex[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(S.u('u_tgt0'), 2); gl.uniform1i(S.u('u_tgt1'), 3);
    gl.uniform1f(S.u('u_tgtA'), X.tgtA); gl.uniform1f(S.u('u_tgtB'), X.tgtB);
    gl.uniform3f(S.u('u_tgtBoff'), X.tgtBoff[0], X.tgtBoff[1], 0);
    gl.bindVertexArray(this.vao[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buf[dst]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    this.cur = dst;

    // 2) 残像バッファへ描画
    const aSrc = this.acc[this.accCur], aDst = this.acc[1 - this.accCur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, aDst.fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    const T = this.pTrail;
    gl.useProgram(T.p);
    gl.bindVertexArray(this.vaoTri);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, aSrc.tex);
    gl.uniform1i(T.u('u_prev'), 0);
    gl.uniform2f(T.u('u_g'), u.gaze.x / this.aspect + .5, u.gaze.y + .5);
    const k = dt * 60;
    gl.uniform1f(T.u('u_decay'), Math.pow(Math.max(.7, .925 - u.vol * .05), k));
    gl.uniform1f(T.u('u_zoom'), (.0012 + u.vol * .012 + u.climax * .004) * k);
    gl.uniform1f(T.u('u_rot'), u.val * .0009 * k);
    gl.uniform1f(T.u('u_asp'), this.aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const P = this.pPart;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('u_vp'), false, this.vp);
    gl.uniform1f(P.u('u_px'), this.H * .0058);
    gl.uniform1f(P.u('u_val'), u.val); gl.uniform1f(P.u('u_hue'), u.hue + u.climax * u.t * .08);
    gl.uniform1f(P.u('u_energy'), u.energy); gl.uniform1f(P.u('u_climax'), u.climax);
    gl.uniform1f(P.u('u_tgtA'), u.fx.tgtA); gl.uniform1f(P.u('u_tgtB'), u.fx.tgtB);
    gl.uniform3f(P.u('u_tgtBcol'), u.fx.tgtBcol[0], u.fx.tgtBcol[1], u.fx.tgtBcol[2]);
    gl.bindVertexArray(this.vao[this.cur]);
    gl.drawArrays(gl.POINTS, 0, this.drawN);

    if (u.face && this.faceOn && this.faceIdxN) {
      const L = this.pLine;
      gl.useProgram(L.p);
      gl.bindVertexArray(this.faceVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, u.face);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.uniformMatrix4fv(L.u('u_vp'), false, this.vp);
      gl.uniform3f(L.u('u_off'), 0, 0, -.5);
      const fc = u.faceCol;
      gl.uniform3f(L.u('u_c'), fc[0], fc[1], fc[2]);
      gl.drawElements(gl.LINES, this.faceIdxN, gl.UNSIGNED_SHORT, 0);
    }
    if (u.handMesh && this.handIdxN) {
      const L = this.pLine;
      gl.useProgram(L.p);
      gl.bindVertexArray(this.handVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.handBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, u.handMesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.uniformMatrix4fv(L.u('u_vp'), false, this.vp);
      gl.uniform3f(L.u('u_off'), 0, 0, 0);
      const fc = u.faceCol, k = 1.5 * u.handMeshA;
      gl.uniform3f(L.u('u_c'), fc[0] * k, fc[1] * k, fc[2] * k);
      gl.drawElements(gl.LINES, this.handIdxN, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
    this.accCur = 1 - this.accCur;

    // 3) ブルーム
    const B = this.pBlur;
    gl.useProgram(B.p); gl.bindVertexArray(this.vaoTri); gl.uniform1i(B.u('u_tex'), 0);
    const pass = (from, to, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb); gl.viewport(0, 0, to.w, to.h);
      gl.bindTexture(gl.TEXTURE_2D, from.tex); gl.uniform2f(B.u('u_dir'), dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const q0 = this.q[0], q1 = this.q[1];
    pass(aDst, this.half, 0, 0);
    pass(this.half, q0, 1 / q0.w, 0); pass(q0, q1, 0, 1 / q0.h);
    pass(q1, q0, 2.2 / q0.w, 0); pass(q0, q1, 0, 2.2 / q0.h);

    // 4) 合成
    const C = this.pComp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, aDst.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, q1.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(C.u('u_acc'), 0); gl.uniform1i(C.u('u_blm'), 1);
    gl.uniform2f(C.u('u_res'), this.W, this.H); gl.uniform2f(C.u('u_gz'), u.gaze.x, u.gaze.y);
    gl.uniform3f(C.u('u_hd'), u.handP.x, u.handP.y, u.handP.on);
    const X2 = u.fx, wc = this.project(0, 0);
    gl.uniform2f(C.u('u_rayP'), X2.rayP.x, X2.rayP.y); gl.uniform1f(C.u('u_rayA'), X2.rayA);
    gl.uniform1f(C.u('u_waveA'), X2.waveA); gl.uniform1f(C.u('u_flowerA'), X2.flower);
    gl.uniform3f(C.u('u_wk'), wc.x, wc.y, .5 * this.F / this.cam.z);
    gl.uniform3f(C.u('u_sun'), X2.sunP, X2.sunA, X2.sunType); gl.uniform1f(C.u('u_night'), X2.night);
    gl.uniform4f(C.u('u_met'), X2.met[0], X2.met[1], X2.met[2], X2.met[3]); gl.uniform1f(C.u('u_metT'), X2.metT);
    gl.uniform1f(C.u('u_starB'), X2.starB); gl.uniform2f(C.u('u_windS'), u.wind.x, u.wind.y);
    gl.uniform1f(C.u('u_t'), u.t); gl.uniform1f(C.u('u_val'), u.val); gl.uniform1f(C.u('u_hue'), u.hue);
    gl.uniform1f(C.u('u_vol'), u.vol); gl.uniform1f(C.u('u_flash'), u.flash); gl.uniform1f(C.u('u_climax'), u.climax);
    gl.uniform1f(C.u('u_beat'), u.beat); gl.uniform1f(C.u('u_bright'), u.bright);
    gl.uniform1f(C.u('u_gzOn'), u.gazeOn); gl.uniform1f(C.u('u_orbOn'), u.orbOn);
    gl.uniform4fv(C.u('u_orb'), this.orbS); gl.uniform1fv(C.u('u_orbD'), this.orbD); gl.uniform1i(C.u('u_link'), u.link);
    gl.uniform1fv(C.u('u_hist'), u.hist); gl.uniform1fv(C.u('u_histA'), u.histA);
    const sp = this.project(u.shock.x, u.shock.y);
    gl.uniform3f(C.u('u_shock'), sp.x, sp.y, u.shock.t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
