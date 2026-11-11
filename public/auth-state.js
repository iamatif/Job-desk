export const auth={user:null,csrf:'',googleAvailable:false};
export async function api(path,method='GET',body,extraHeaders={}){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(auth.csrf?{'x-csrf-token':auth.csrf}:{}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'Please try again.');error.status=response.status;throw error;}return data;
}
export async function loadSession(){try{Object.assign(auth,await api('/api/auth/me'));return true;}catch(e){if(e.status===401)return false;throw e;}}
