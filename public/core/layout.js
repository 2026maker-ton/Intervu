// Progressive disclosure for the coaching workspace; all original form fields keep their names.
import { $ } from './format.js';
function tabs(host, groups, label) {
 const nav=document.createElement('div');nav.className='workspace-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',label);
 groups.forEach(([name,nodes],index)=>{
 const panel=document.createElement('section');panel.id='panel-'+label+'-'+index;panel.setAttribute('role','tabpanel');
 nodes.filter(Boolean).forEach(n=>panel.append(n));host.append(panel);
 const button=document.createElement('button');button.type='button';button.textContent=name;button.id='tab-'+label+'-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',button.id);
 const select=()=>{[...nav.children].forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;document.getElementById(b.getAttribute('aria-controls')).hidden=i!==index;});};
 button.addEventListener('click',select);button.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const list=[...nav.children];const next=e.key==='Home'?0:e.key==='End'?list.length-1:(index+(e.key==='ArrowRight'?1:list.length-1))%list.length;list[next].click();list[next].focus();}});
 nav.append(button);panel.hidden=index!==0;button.setAttribute('aria-selected',String(index===0));button.tabIndex=index===0?0:-1;
 });host.prepend(nav);
}
const history=$('#screen-history');if(history){const cards=[...history.querySelectorAll(':scope > .card')];const grid=history.querySelector('.panel-grid');tabs(history,[['연습 기록',cards],['데이터 관리',[grid]]],'history');}
const admin=$('#adminPanel');if(admin){const cards=[...admin.children];tabs(admin,[['초안 작성',[cards[0]]],['검토·공개',[cards[2]]],['버전 이력',[cards[1]]]],'admin');}
const form=$('#applicationForm');if(form){
 const source=$('#sourceText').closest('label'),application=$('#applicationText').closest('label');const file=$('#docFile').closest('.field-row');
 const host=document.createElement('div');source.before(host);tabs(host,[['텍스트 붙여넣기',[source,application]],['파일 업로드',[file]]],'documents');
 const memo=form.querySelector('[name=experiences]')?.closest('label');if(memo){const d=document.createElement('details');d.innerHTML='<summary>추가 정보 · 경험 메모</summary>';memo.before(d);d.append(memo);}
}
