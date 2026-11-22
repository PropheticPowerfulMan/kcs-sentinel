type SchoolLogoProps = {compact?:boolean;caption?:string};
export function SchoolLogo({compact=false,caption="Attendance & access"}:SchoolLogoProps){
 const logoSrc=`${import.meta.env.BASE_URL}icons/kcs-logo.jpg`;
 return <div className="sr-school-brand" data-compact={compact}><span className="sr-brand-seal"><img src={logoSrc} alt="KCS"/></span><span className="sr-brand-wordmark"><small>KCS ORBIT</small><strong className="sr-brand-name">Sentinel<span aria-hidden="true"/></strong><em>{caption}</em></span></div>;
}
