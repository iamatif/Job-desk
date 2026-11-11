(() => {
 const key='jobdesk-appearance';
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 let preference=null;
 try{const stored=localStorage.getItem(key);if(['light','dark'].includes(stored))preference=stored;}catch{}
 const apply=theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;window.dispatchEvent(new CustomEvent('jobdesk:theme',{detail:theme}));};
 const current=()=>preference||(media.matches?'dark':'light');
 apply(current());
 window.JobdeskTheme={current,toggle(){preference=current()==='dark'?'light':'dark';try{localStorage.setItem(key,preference);}catch{}apply(preference);}};
 media.addEventListener('change',()=>{if(!preference)apply(current());});
 window.addEventListener('storage',event=>{if(event.key===key){preference=['light','dark'].includes(event.newValue)?event.newValue:null;apply(current());}});
})();
