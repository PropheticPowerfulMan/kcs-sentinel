import {useEffect,useRef} from 'react'
import {createPortal} from 'react-dom'
export type OperationResult={kind:'success'|'error';title:string;message:string}
export default function OperationResultDialog({result,onClose,language}:{result:OperationResult|null;onClose:()=>void;language:string}){
 const closeRef=useRef<HTMLButtonElement>(null),onCloseRef=useRef(onClose);onCloseRef.current=onClose
 useEffect(()=>{if(!result)return;const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';const frame=requestAnimationFrame(()=>closeRef.current?.focus());const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onCloseRef.current()}if(event.key==='Tab'){event.preventDefault();closeRef.current?.focus()}};document.addEventListener('keydown',key);return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',key);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()}},[result])
 if(!result)return null
 return createPortal(<div data-sentinel-result data-result-kind={result.kind} role="alertdialog" aria-modal="true" aria-labelledby="sentinel-result-title" aria-describedby="sentinel-result-message"><section className="sr-result-card"><span className="sr-result-symbol" aria-hidden="true">{result.kind==='success'?'✓':'!'}</span><small>KCS SENTINEL</small><h2 id="sentinel-result-title">{result.title}</h2><p id="sentinel-result-message">{result.message}</p><button ref={closeRef} type="button" onClick={onClose}>{language==='fr'?'Compris':'Done'}</button></section></div>,document.body)
}
