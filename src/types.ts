export type Pair={key:string;value:string;enabled:boolean;description:string;kind?:string;isSecret?:boolean;secretRef?:string};
export type RequestSpec={id:string;name:string;method:string;url:string;params:Pair[];headers:Pair[];auth:any;body:any;settings:any;metadata:any};
export type Item={id:string;collectionId:string;parentId:string|null;kind:string;name:string;order:number;auth:any;request:RequestSpec|null;metadata:any};
export type Collection={id:string;name:string;auth:any;variables:Pair[];metadata:any};
export type Environment={id:string;name:string;variables:Pair[];settings:any;metadata:any};
export type Workspace={collections:Collection[];items:Item[];environments:Environment[];globals:Pair[];settings:any;activeEnvironment:string|null};
export type ResponseResult={status:number;statusText:string;headers:[string,string][];body:string;duration:number;size:number;contentType:string;finalUrl:string;redirects:string[];file:string;truncated:boolean;binary:boolean};
export const pair=():Pair=>({key:'',value:'',enabled:true,description:''});
export const newRequest=():RequestSpec=>({id:crypto.randomUUID(),name:'Untitled request',method:'GET',url:'',params:[],headers:[],auth:{type:'inherit'},body:{mode:'none'},settings:{},metadata:null});
export function paramsFromUrl(url:string,old:Pair[]=[]):Pair[]{const query=url.split('?')[1]?.split('#')[0];if(!query)return old.filter(p=>!p.enabled);return [...Array.from(new URLSearchParams(query)).map(([key,value])=>({...pair(),key,value})),...old.filter(p=>!p.enabled)];}
export function urlFromParams(url:string,params:Pair[]):string{const [base,hash]=url.split('#');const query=params.filter(p=>p.enabled&&p.key).map(p=>`${encodeURIComponent(p.key).replaceAll('%7B','{').replaceAll('%7D','}')}=${encodeURIComponent(p.value).replaceAll('%7B','{').replaceAll('%7D','}')}`).join('&');return base.split('?')[0]+(query?'?'+query:'')+(hash?'#'+hash:'');}
