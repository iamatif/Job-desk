export function bindSettingsTabs(root,{initialPanel}={}){
 for(const group of root.querySelectorAll('[data-settings-tabs]')){
  const tabs=[...group.querySelectorAll('[role="tab"]')].filter(tab=>tab.closest('[data-settings-tabs]')===group);
  const select=(tab,focus=false)=>{for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;const panel=document.getElementById(item.getAttribute('aria-controls'));if(panel)panel.hidden=!selected;}if(focus)tab.focus();};
  for(const [index,tab] of tabs.entries()){
   tab.onclick=()=>select(tab);
   tab.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();select(tabs[next],true);};
  }
  const first=tabs.find(tab=>tab.getAttribute('aria-controls')===initialPanel)||tabs.find(tab=>tab.getAttribute('aria-selected')==='true')||tabs[0];if(first)select(first);
 }
}
