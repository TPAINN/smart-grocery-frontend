import { readFileSync, writeFileSync } from 'fs';

const file = 'src/App.jsx';
const lines = readFileSync(file, 'utf8').split('\n');

// Replace lines 5020-5565 (0-indexed: 5019 to 5564)
const START = 5019; // 0-indexed line 5020
const END   = 5564; // 0-indexed line 5565 (inclusive)

const newContent = `
            {/* ── Quiz Header ── */}
            {mealPlanStep === 1 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  {quizSlide > 0
                    ? <button onClick={() => { setQuizDir('bck'); setQuizSlide(s => s-1); }}
                        style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight:700, fontSize:13, padding:'6px 0' }}>
                        ← Πίσω
                      </button>
                    : <div/>
                  }
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>Βήμα {quizSlide + 1} / 8</span>
                    <div style={{ display:'flex', gap:3 }}>
                      {Array.from({length:8}).map((_,i) => (
                        <div key={i} style={{ width:i===quizSlide?16:5, height:5, borderRadius:99, background:i<=quizSlide?'#6366f1':'var(--bg-subtle)', transition:'all 0.3s ease' }}/>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Quiz Slides ── */}
            {mealPlanStep === 1 && (
              <div style={{ overflow:'hidden' }}>
                <div key={quizSlide} className={\`quiz-slide quiz-slide-\${quizDir}\`}>

                  {/* SLIDE 0: Gender */}
                  {quizSlide === 0 && (
                    <div className="quiz-slide-body" style={{ alignItems:'center', gap:22 }}>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:46, marginBottom:10 }}>⚕️</div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το φύλο σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:8, lineHeight:1.5 }}>Χρειάζεται για τον υπολογισμό του μεταβολισμού σου</div>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, width:'100%' }}>
                        {[['male','♂','Άνδρας','#6366f1'],['female','♀','Γυναίκα','#ec4899']].map(([v,icon,label,color]) => (
                          <button key={v} onClick={() => setTdeeGender(v)}
                            style={{ padding:'32px 10px', borderRadius:20, border:\`2.5px solid \${tdeeGender===v?color:'var(--border)'}\`, background:tdeeGender===v?\`\${color}14\`:'var(--bg-card)', cursor:'pointer', transition:'all 0.2s', display:'flex', flexDirection:'column', alignItems:'center', gap:10, position:'relative' }}>
                            {tdeeGender===v && <div style={{ position:'absolute', top:10, right:10, width:22, height:22, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:900 }}>✓</div>}
                            <span style={{ fontSize:48 }}>{icon}</span>
                            <span style={{ fontWeight:800, fontSize:16, color:tdeeGender===v?color:'var(--text-primary)' }}>{label}</span>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeGender){ setQuizDir('fwd'); setQuizSlide(1); } }}
                        disabled={!tdeeGender}
                        style={{ width:'100%', padding:'15px', background:tdeeGender?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeGender?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeGender?'pointer':'not-allowed', boxShadow:tdeeGender?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeGender ? 'Επόμενο →' : 'Επέλεξε φύλο'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 1: Age */}
                  {quizSlide === 1 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πόσων χρονών είσαι;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Η ηλικία επηρεάζει τον βασικό μεταβολισμό σου</div>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {[['15-18','🧑'],['18-22','🎓'],['22-28','💼'],['28-35','👨'],['35-45','🧔'],['45-55','👨‍💼'],['55-65','🧓'],['65+','👴']].map(([val,emoji]) => (
                          <button key={val} onClick={() => setTdeeAge(val)}
                            style={{ padding:'12px 10px', borderRadius:14, border:\`2px solid \${tdeeAge===val?'#6366f1':'var(--border)'}\`, background:tdeeAge===val?'rgba(99,102,241,0.1)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:20 }}>{emoji}</span>
                            <span style={{ fontWeight:800, fontSize:14, color:tdeeAge===val?'#6366f1':'var(--text-primary)' }}>{val}</span>
                            <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:'auto' }}>ετών</span>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeAge){ setQuizDir('fwd'); setQuizSlide(2); } }}
                        disabled={!tdeeAge}
                        style={{ width:'100%', padding:'15px', background:tdeeAge?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeAge?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeAge?'pointer':'not-allowed', boxShadow:tdeeAge?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeAge ? 'Επόμενο →' : 'Επέλεξε ηλικία'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 2: Height */}
                  {quizSlide === 2 && (
                    <div className="quiz-slide-body" style={{ gap:24, alignItems:'center' }}>
                      <div style={{ width:'100%' }}>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το ύψος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Σε εκατοστά (cm)</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:24 }}>
                          <button onClick={() => setTdeeHeight(h => Math.max(140, h-1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                          <div style={{ textAlign:'center', minWidth:120 }}>
                            <div style={{ fontWeight:900, fontSize:64, color:'#6366f1', lineHeight:1, letterSpacing:-2 }}>{tdeeHeight}</div>
                            <div style={{ fontSize:15, color:'var(--text-muted)', fontWeight:700, marginTop:4 }}>cm</div>
                          </div>
                          <button onClick={() => setTdeeHeight(h => Math.min(220, h+1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                        </div>
                        <input type="range" min={140} max={220} value={tdeeHeight} onChange={e => setTdeeHeight(+e.target.value)} style={{ width:'90%', accentColor:'#6366f1' }}/>
                        <div style={{ display:'flex', justifyContent:'space-between', width:'90%', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
                          <span>140cm</span><span>180cm</span><span>220cm</span>
                        </div>
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(3); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 3: Weight */}
                  {quizSlide === 3 && (
                    <div className="quiz-slide-body" style={{ gap:24, alignItems:'center' }}>
                      <div style={{ width:'100%' }}>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το βάρος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Σε κιλά (kg)</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:24 }}>
                          <button onClick={() => setTdeeWeight(w => Math.max(30, w-1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                          <div style={{ textAlign:'center', minWidth:120 }}>
                            <div style={{ fontWeight:900, fontSize:64, color:'#6366f1', lineHeight:1, letterSpacing:-2 }}>{tdeeWeight}</div>
                            <div style={{ fontSize:15, color:'var(--text-muted)', fontWeight:700, marginTop:4 }}>kg</div>
                          </div>
                          <button onClick={() => setTdeeWeight(w => Math.min(200, w+1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                        </div>
                        <input type="range" min={30} max={200} value={tdeeWeight} onChange={e => setTdeeWeight(+e.target.value)} style={{ width:'90%', accentColor:'#6366f1' }}/>
                        <div style={{ display:'flex', justifyContent:'space-between', width:'90%', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
                          <span>30kg</span><span>115kg</span><span>200kg</span>
                        </div>
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(4); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 4: Activity */}
                  {quizSlide === 4 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πόσο αθλείσαι;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Επηρεάζει τις ημερήσιες θερμίδες σου</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          ['sedentary','🪑','Καθιστικός','Γραφείο · χωρίς άσκηση'],
                          ['light','🚶','Ελαφρύ','1-2 προπονήσεις/εβδομάδα'],
                          ['moderate','🏃','Μέτριο','3-5 προπονήσεις/εβδομάδα'],
                          ['active','💪','Ενεργός','6-7 προπονήσεις/εβδομάδα'],
                          ['veryactive','🔥','Έντονο','2 προπονήσεις/μέρα'],
                        ].map(([v,icon,label,sub]) => (
                          <button key={v} onClick={() => setTdeeActivity(v)}
                            style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:14, border:\`2px solid \${tdeeActivity===v?'#6366f1':'var(--border)'}\`, background:tdeeActivity===v?'rgba(99,102,241,0.08)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                            <span style={{ fontSize:26, flexShrink:0 }}>{icon}</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:800, fontSize:14, color:tdeeActivity===v?'#6366f1':'var(--text-primary)' }}>{label}</div>
                              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>
                            </div>
                            {tdeeActivity===v && <div style={{ width:22, height:22, borderRadius:'50%', background:'#6366f1', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:12, fontWeight:900, flexShrink:0 }}>✓</div>}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeActivity){ setQuizDir('fwd'); setQuizSlide(5); } }}
                        disabled={!tdeeActivity}
                        style={{ width:'100%', padding:'15px', background:tdeeActivity?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeActivity?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeActivity?'pointer':'not-allowed', boxShadow:tdeeActivity?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeActivity ? 'Επόμενο →' : 'Επέλεξε επίπεδο'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 5: Goal */}
                  {quizSlide === 5 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιος είναι ο στόχος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Καθορίζει τις θερμίδες του πλάνου σου</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          { k:'muscle',  icon:'💪', label:'Bulk — Μυϊκή Μάζα',   sub:'Αύξηση δύναμης & όγκου',          kcal:'+300', color:'#10b981' },
                          { k:'maintain',icon:'⚖️', label:'Διατήρηση Βάρους',    sub:'Ισορροπία, καμία αλλαγή',          kcal:'0',    color:'#6366f1' },
                          { k:'mild',    icon:'📉', label:'Ήπια Απώλεια',         sub:'Αργή & σταθερή μείωση',            kcal:'−250', color:'#a78bfa' },
                          { k:'loss',    icon:'🔥', label:'Cut — Απώλεια Βάρους', sub:'Αποτελεσματική καύση λίπους',      kcal:'−500', color:'#f59e0b' },
                          { k:'extreme', icon:'⚡', label:'Έντονη Απώλεια',       sub:'Γρήγορα αποτελέσματα (προσοχή!)', kcal:'−1000',color:'#ef4444' },
                          { k:'budget',  icon:'💰', label:'Οικονομία',            sub:'Χαμηλό κόστος, υγιεινό πλάνο',    kcal:'0',    color:'#f59e0b' },
                        ].map(({k,icon,label,sub,kcal,color}) => {
                          const active = mealPlanPrefs.goal===k;
                          return (
                            <button key={k} onClick={() => setMealPlanPrefs(p => ({...p, goal:k}))}
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderRadius:14, border:\`2px solid \${active?color:'var(--border)'}\`, background:active?\`\${color}12\`:'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                              <span style={{ fontSize:24, flexShrink:0 }}>{icon}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:800, fontSize:13, color:active?color:'var(--text-primary)' }}>{label}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>
                              </div>
                              <div style={{ flexShrink:0, background:active?\`\${color}18\`:'var(--bg-subtle)', borderRadius:8, padding:'4px 8px', fontSize:11, fontWeight:800, color:active?color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                                {kcal} kcal
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => { if(mealPlanPrefs.goal){ setQuizDir('fwd'); setQuizSlide(6); } }}
                        disabled={!mealPlanPrefs.goal}
                        style={{ width:'100%', padding:'15px', background:mealPlanPrefs.goal?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:mealPlanPrefs.goal?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:mealPlanPrefs.goal?'pointer':'not-allowed', boxShadow:mealPlanPrefs.goal?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 6: Diet style */}
                  {quizSlide === 6 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πώς τρως συνήθως;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Καθορίζει αναλογία πρωτεΐνης · υδατανθράκων · λιπαρών</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          { icon:'🫒', label:'Μεσογειακό',       sub:'Ελαιόλαδο, λαχανικά, κρέας',        p:30, c:40, f:30 },
                          { icon:'💪', label:'Υψηλή Πρωτεΐνη',   sub:'Κρέας, αυγά, γυμναστήριο',           p:35, c:40, f:25 },
                          { icon:'⚡', label:'Αθλητική',         sub:'Πολλοί υδατάνθρακες, cardio',        p:25, c:55, f:20 },
                          { icon:'🥑', label:'Low Carb',          sub:'Χωρίς ψωμί/ζυμαρικά, καλά λιπαρά', p:30, c:15, f:55 },
                          { icon:'🔥', label:'Κετογονική',        sub:'Ελάχιστοι υδατ/κες, κέτωση',        p:25, c:5,  f:70 },
                        ].map(preset => {
                          const active = macroRatios.protein===preset.p && macroRatios.carbs===preset.c && macroRatios.fat===preset.f;
                          return (
                            <button key={preset.label} onClick={() => setMacroRatios({protein:preset.p, carbs:preset.c, fat:preset.f})}
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderRadius:14, border:\`2px solid \${active?'#6366f1':'var(--border)'}\`, background:active?'rgba(99,102,241,0.08)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                              <span style={{ fontSize:24, flexShrink:0 }}>{preset.icon}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:800, fontSize:13, color:active?'#6366f1':'var(--text-primary)' }}>{preset.label}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{preset.sub}</div>
                              </div>
                              <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                                {[{v:preset.p,c:'#6366f1',l:'P'},{v:preset.c,c:'#10b981',l:'C'},{v:preset.f,c:'#f59e0b',l:'F'}].map(({v,c,l})=>(
                                  <div key={l} style={{ fontSize:10, fontWeight:800, color:c, background:\`\${c}14\`, borderRadius:6, padding:'2px 5px' }}>{v}%{l}</div>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(7); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 7: Settings + TDEE preview */}
                  {quizSlide === 7 && (() => {
                    const w = parseFloat(tdeeWeight), h = parseFloat(tdeeHeight);
                    const ageStr = String(tdeeAge);
                    let a = ageStr==='65+' ? 68 : (() => { const p=ageStr.split('-'); return p.length===2?(parseFloat(p[0])+parseFloat(p[1]))/2:parseFloat(ageStr); })();
                    const bmrVal = (w&&h&&a) ? (tdeeGender==='male'?10*w+6.25*h-5*a+5:10*w+6.25*h-5*a-161) : null;
                    const mults = {sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryactive:1.9};
                    const tdeeEst = bmrVal ? Math.round(bmrVal*(mults[tdeeActivity]||1.55)) : null;
                    const adjMap = {maintain:0,mild:-250,loss:-500,extreme:-1000,muscle:300,budget:0};
                    const adj = adjMap[mealPlanPrefs.goal]??0;
                    const targetKcal = tdeeEst ? tdeeEst+adj : null;
                    return (
                      <div className="quiz-slide-body" style={{ gap:14 }}>
                        <div style={{ fontWeight:900, fontSize:20, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ρύθμισε το πλάνο σου</div>
                        {targetKcal && (
                          <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))', border:'1.5px solid rgba(99,102,241,0.2)', borderRadius:16, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <div>
                              <div style={{ fontSize:11, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:0.5, marginBottom:2 }}>⚡ Στόχος θερμίδων</div>
                              <div style={{ fontWeight:900, fontSize:30, color:'var(--text-primary)', letterSpacing:-1 }}>{targetKcal} <span style={{ fontSize:14, fontWeight:600, color:'var(--text-muted)' }}>kcal/μέρα</span></div>
                            </div>
                            <div style={{ textAlign:'right', fontSize:12, color:'var(--text-muted)' }}>
                              <div>TDEE: <strong>{tdeeEst}</strong> kcal</div>
                              <div style={{ color:adj<0?'#ef4444':adj>0?'#10b981':'var(--text-muted)', fontWeight:700, marginTop:3 }}>{adj>0?'+':''}{adj} kcal</div>
                            </div>
                          </div>
                        )}
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>👥 ΑΤΟΜΑ</div>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <button onClick={() => setMealPlanPrefs(p => ({...p, persons:Math.max(1,p.persons-1)}))}
                              style={{ width:44, height:44, borderRadius:12, border:'2px solid var(--border)', background:'var(--bg-surface)', fontSize:22, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                            <div style={{ textAlign:'center' }}>
                              <span style={{ fontWeight:900, fontSize:36, color:'var(--text-primary)' }}>{mealPlanPrefs.persons}</span>
                              <span style={{ fontSize:13, color:'var(--text-muted)', marginLeft:6 }}>άτομο{mealPlanPrefs.persons!==1?'α':''}</span>
                            </div>
                            <button onClick={() => setMealPlanPrefs(p => ({...p, persons:Math.min(8,p.persons+1)}))}
                              style={{ width:44, height:44, borderRadius:12, border:'2px solid var(--border)', background:'var(--bg-surface)', fontSize:22, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>📅 ΔΙΑΡΚΕΙΑ ΠΛΑΝΟΥ</div>
                          <div style={{ display:'flex', gap:8 }}>
                            {[3,5,7].map(d => (
                              <button key={d} onClick={() => setMealPlanPrefs(p => ({...p, days:d}))}
                                style={{ flex:1, padding:'13px 0', borderRadius:12, border:\`2px solid \${mealPlanPrefs.days===d?'#6366f1':'var(--border)'}\`, background:mealPlanPrefs.days===d?'rgba(99,102,241,0.12)':'var(--bg-surface)', color:mealPlanPrefs.days===d?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:16, cursor:'pointer', transition:'all 0.2s', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                                {d}<span style={{ fontSize:10, fontWeight:600 }}>μέρες</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)' }}>💰 ΕΒΔΟΜΑΔΙΑΙΟ BUDGET</div>
                            <div style={{ fontWeight:900, fontSize:22, color:'#10b981' }}>{mealPlanPrefs.budget}€</div>
                          </div>
                          <input type="range" min={20} max={300} step={5} value={mealPlanPrefs.budget} onChange={e => setMealPlanPrefs(p => ({...p, budget:+e.target.value}))} style={{ width:'100%', accentColor:'#6366f1' }}/>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                            <span>20€</span><span>160€</span><span>300€</span>
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>🚫 ΠΕΡΙΟΡΙΣΜΟΙ <span style={{ fontWeight:500, color:'var(--text-muted)' }}>(προαιρετικό)</span></div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                            {[['vegan','🌱 Vegan'],['vegetarian','🥗 Vegetarian'],['gluten-free','🌾 Χωρίς Γλουτένη'],['lactose-free','🥛 Χωρίς Λακτόζη'],['nut-free','🥜 Χωρίς Ξηρούς Καρπούς']].map(([r,label]) => {
                              const active = mealPlanPrefs.restrictions.includes(r);
                              return (
                                <button key={r} onClick={() => setMealPlanPrefs(p => ({...p, restrictions:active?p.restrictions.filter(x=>x!==r):[...p.restrictions,r]}))}
                                  style={{ padding:'8px 14px', borderRadius:20, border:\`1.5px solid \${active?'#6366f1':'var(--border)'}\`, background:active?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:active?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:12, cursor:'pointer', transition:'all 0.2s' }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {mealPlanError && (
                          <div style={{ background:'rgba(239,68,68,0.08)', border:'1.5px solid rgba(239,68,68,0.25)', borderRadius:12, padding:'12px 14px', color:'#ef4444', fontSize:13 }}>{mealPlanError}</div>
                        )}
                        <button onClick={generateMealPlan} disabled={mealPlanLoading}
                          style={{ padding:'17px', border:'none', borderRadius:16, fontWeight:900, fontSize:17, cursor:mealPlanLoading?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:mealPlanLoading?'var(--bg-surface)':'linear-gradient(135deg,#6366f1,#8b5cf6)', color:mealPlanLoading?'var(--text-secondary)':'#fff', boxShadow:mealPlanLoading?'none':'0 6px 24px rgba(99,102,241,0.4)', transition:'all 0.3s' }}>
                          {mealPlanLoading
                            ? <><div style={{ width:20, height:20, border:'2.5px solid rgba(99,102,241,0.2)', borderTopColor:'#6366f1', borderRadius:'50%', animation:'spin 0.85s linear infinite' }}/><span style={{ fontWeight:800, fontSize:14, color:'var(--text-primary)' }}>Δημιουργία πλάνου...</span></>
                            : <><IconSparkles size={20} stroke={2}/> Δημιούργησε το Πλάνο μου ✨</>
                          }
                        </button>
                      </div>
                    );
                  })()}

                </div>
              </div>
            )}

            {/* ════ STEP 3: RESULTS ════ */}
            {mealPlanStep === 3 && mealPlan && (() => {
              const renderCard = (meal, isAlt) => {
                if (!meal) return null;
                return (
                  <div style={{ background:isAlt?'var(--bg-surface)':'var(--bg-card)', border:\`1.5px solid \${isAlt?'var(--border)':'rgba(99,102,241,0.15)'}\`, borderRadius:16, padding:'14px 16px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                          <div style={{ fontSize:10, fontWeight:800, color:isAlt?'var(--text-muted)':'#6366f1', background:isAlt?'var(--bg-subtle)':'rgba(99,102,241,0.1)', borderRadius:6, padding:'2px 7px', letterSpacing:0.3 }}>
                            {isAlt?'ΕΠΙΛΟΓΗ Β':'ΕΠΙΛΟΓΗ Α'}
                          </div>
                          {meal.time && <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)' }}>⏱ {meal.time}′</div>}
                        </div>
                        <div style={{ fontWeight:900, fontSize:16, color:'var(--text-primary)', lineHeight:1.3 }}>{meal.name}</div>
                      </div>
                    </div>
                    {meal.macros && (
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
                        {[{k:'kcal',l:'kcal',c:'#f59e0b'},{k:'protein',l:'P',c:'#6366f1'},{k:'carbs',l:'C',c:'#10b981'},{k:'fat',l:'F',c:'#ef4444'}].map(({k,l,c}) =>
                          meal.macros[k]!=null && (
                            <div key={k} style={{ background:\`\${c}12\`, border:\`1px solid \${c}22\`, borderRadius:8, padding:'3px 8px', fontSize:11, fontWeight:800, color:c, display:'flex', alignItems:'center', gap:2 }}>
                              {meal.macros[k]}<span style={{ fontSize:9, opacity:0.8 }}>{l}</span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                    {meal.description && (
                      <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.6, marginBottom:10 }}>{meal.description}</div>
                    )}
                    {meal.ingredients?.length>0 && (
                      <div style={{ marginBottom:meal.prepTip?10:0 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:0.3, marginBottom:6 }}>🛒 Υλικά</div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                          {meal.ingredients.map((ing,j) => {
                            const ingName = typeof ing==='string'?ing:ing.name;
                            const ingPrice = typeof ing==='object'&&ing.price?\`\${ing.price.toFixed?ing.price.toFixed(2):ing.price}€\`:null;
                            const found = typeof ing==='object'&&ing.found;
                            return (
                              <span key={j} style={{ fontSize:11, padding:'4px 10px', borderRadius:20, fontWeight:600, background:found?'rgba(16,185,129,0.08)':'var(--bg-subtle)', border:\`1px solid \${found?'rgba(16,185,129,0.2)':'var(--border)'}\`, color:found?'#10b981':'var(--text-secondary)' }}>
                                {ingName}{ingPrice?\` · \${ingPrice}\`:''}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {meal.prepTip && (
                      <div style={{ background:'rgba(99,102,241,0.06)', borderLeft:'3px solid #6366f1', borderRadius:'0 10px 10px 0', padding:'8px 12px', marginTop:10, fontSize:11, color:'var(--text-secondary)', fontStyle:'italic', lineHeight:1.5 }}>
                        💡 {meal.prepTip}
                      </div>
                    )}
                  </div>
                );
              };

              const day = mealPlan[activeMealDay] || mealPlan[0];

              return (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  {/* Header */}
                  <div style={{ background:'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(99,102,241,0.07))', border:'1.5px solid rgba(16,185,129,0.2)', borderRadius:20, padding:'18px 20px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:19, color:'var(--text-primary)', letterSpacing:-0.5 }}>🎉 Το πλάνο σου είναι έτοιμο!</div>
                        <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:3 }}>{mealPlan.length} μέρες · {mealPlanPrefs.persons} άτομο{mealPlanPrefs.persons!==1?'α':''} · 2 επιλογές ανά γεύμα</div>
                      </div>
                      <button onClick={() => { setMealPlan(null); setMealPlanStats(null); setMealPlanShoppingList([]); setMealPlanSummary(null); setMealPlanStep(1); setQuizSlide(0); }}
                        style={{ background:'var(--bg-surface)', border:'1.5px solid var(--border)', borderRadius:12, padding:'8px 12px', fontSize:12, fontWeight:700, cursor:'pointer', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                        <IconRefresh size={13}/> Νέο
                      </button>
                    </div>
                    {mealPlanSummary && (
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                        {[
                          { label:'kcal/μέρα', value:mealPlanSummary.avgKcalPerDay||'—', color:'#f59e0b', icon:'🔥' },
                          { label:'Πρωτεΐνη', value:mealPlanSummary.avgProteinPerDay?\`\${mealPlanSummary.avgProteinPerDay}g\`:'—', color:'#6366f1', icon:'💪' },
                          { label:'Βρέθηκαν', value:mealPlanStats?\`\${mealPlanStats.foundInDB}/\${mealPlanStats.totalIngredients}\`:'—', color:'#10b981', icon:'✓' },
                          { label:'Κόστος', value:mealPlanStats?.estimatedTotalCost?\`\${mealPlanStats.estimatedTotalCost.toFixed(0)}€\`:'—', color:'#a78bfa', icon:'💰' },
                        ].map(({label,value,color,icon}) => (
                          <div key={label} style={{ background:\`\${color}12\`, border:\`1px solid \${color}22\`, borderRadius:12, padding:'10px 8px', textAlign:'center' }}>
                            <div style={{ fontSize:18, marginBottom:3 }}>{icon}</div>
                            <div style={{ fontWeight:900, fontSize:14, color, lineHeight:1 }}>{value}</div>
                            <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:3, fontWeight:600 }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Day selector */}
                  <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:2, scrollbarWidth:'none' }}>
                    {mealPlan.map((d,i) => {
                      const isSel = activeMealDay===i;
                      return (
                        <button key={i} onClick={() => setActiveMealDay(i)}
                          style={{ flexShrink:0, padding:'10px 16px', borderRadius:14, cursor:'pointer', transition:'all 0.2s', border:isSel?'2px solid #6366f1':'1.5px solid var(--border)', background:isSel?'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))':'var(--bg-card)', color:isSel?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:13 }}>
                          <div style={{ fontSize:9, opacity:0.7, marginBottom:1 }}>Ημ. {d.day||i+1}</div>
                          <div>{d.dayName||\`Ημέρα \${d.day}\`}</div>
                          {d.dayMacros?.kcal && <div style={{ fontSize:9, marginTop:2, opacity:0.6 }}>{d.dayMacros.kcal} kcal</div>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Meals for selected day */}
                  <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

                    {(day.meals?.breakfast||day.meals?.breakfast_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>🌅</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Πρωινό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.breakfast, false)}
                          {day.meals.breakfast_alt && renderCard(day.meals.breakfast_alt, true)}
                        </div>
                      </div>
                    )}

                    {day.snacks?.morning && (
                      <div style={{ display:'flex', gap:10, padding:'10px 14px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:12 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>🍎</span>
                        <div>
                          <div style={{ fontSize:10, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:2 }}>Πρωινό Σνακ</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>{day.snacks.morning}</div>
                        </div>
                      </div>
                    )}

                    {(day.meals?.lunch||day.meals?.lunch_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>☀️</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Μεσημεριανό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.lunch, false)}
                          {day.meals.lunch_alt && renderCard(day.meals.lunch_alt, true)}
                        </div>
                      </div>
                    )}

                    {day.snacks?.afternoon && (
                      <div style={{ display:'flex', gap:10, padding:'10px 14px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:12 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>🥜</span>
                        <div>
                          <div style={{ fontSize:10, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:2 }}>Απογευματινό Σνακ</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>{day.snacks.afternoon}</div>
                        </div>
                      </div>
                    )}

                    {(day.meals?.dinner||day.meals?.dinner_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>🌙</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Βραδινό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.dinner, false)}
                          {day.meals.dinner_alt && renderCard(day.meals.dinner_alt, true)}
                        </div>
                      </div>
                    )}

                    {day.dayMacros && (
                      <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.04))', border:'1.5px solid rgba(99,102,241,0.15)', borderRadius:14, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:12, fontWeight:800, color:'#6366f1' }}>📊 Σύνολο Ημέρας</span>
                        <div style={{ display:'flex', gap:12 }}>
                          {[['kcal','🔥','kcal'],['protein','💪','P'],['carbs','⚡','C'],['fat','🥑','F']].map(([k,e,l]) =>
                            day.dayMacros[k]!=null && (
                              <span key={k} style={{ fontSize:12, fontWeight:800, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:2 }}>
                                <span style={{ fontSize:10 }}>{e}</span>{day.dayMacros[k]}<span style={{ fontSize:9, opacity:0.6 }}>{l}</span>
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {day.waterGlasses && (
                      <div style={{ display:'flex', gap:8, padding:'10px 14px', background:'rgba(59,130,246,0.05)', border:'1px solid rgba(59,130,246,0.15)', borderRadius:12 }}>
                        <span>💧</span>
                        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Στόχος: {day.waterGlasses} ποτήρια νερό</span>
                      </div>
                    )}

                    {day.nutritionNote && (
                      <div style={{ fontSize:12, color:'var(--text-secondary)', fontStyle:'italic', padding:'10px 14px', background:'var(--bg-subtle)', borderRadius:12, lineHeight:1.5 }}>
                        ℹ️ {day.nutritionNote}
                      </div>
                    )}

                    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:10 }}>
                      <button onClick={addMealPlanToCart}
                        style={{ padding:'16px', border:'none', borderRadius:14, fontWeight:800, fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff', boxShadow:'0 4px 20px rgba(16,185,129,0.3)' }}>
                        <IconShoppingCart size={18} stroke={2}/> Πρόσθεσε στη Λίστα
                      </button>
                      <button onClick={() => { setMealPlan(null); setMealPlanStats(null); setMealPlanShoppingList([]); setMealPlanSummary(null); setMealPlanStep(1); setQuizSlide(0); }}
                        style={{ padding:'16px 14px', background:'var(--bg-card)', color:'var(--text-secondary)', border:'1.5px solid var(--border)', borderRadius:14, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                        <IconRefresh size={15} stroke={2}/>
                      </button>
                    </div>

                  </div>
                </div>
              );
            })()}`;

lines.splice(START, END - START + 1, newContent);
writeFileSync(file, lines.join('\n'), 'utf8');
console.log('Done. Total lines:', lines.length);
