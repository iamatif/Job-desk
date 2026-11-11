import {profilePlainText} from './profile-data.js';
export const SAMPLE_PROFILE = {
  name: 'Alex Morgan', role: 'CMS Developer', years: 2.5,
  skills: ['WordPress', 'Shopify', 'Wix', 'Squarespace', 'HTML', 'CSS', 'JavaScript', 'Liquid', 'Elementor', 'WooCommerce', 'Responsive design'],
  summary: 'Fictional CMS developer with 2.5 years of agency and freelance experience building responsive business websites and e-commerce stores. Comfortable with WordPress and Elementor, Shopify theme customization with Liquid, and Wix and Squarespace site builds.',
  experience: 'CMS Developer · Example Studio (fictional) · May 2024–November 2026\nBuilt and maintained WordPress business websites with Elementor and WooCommerce. Customized Shopify themes using Liquid, HTML, CSS and basic JavaScript. Delivered Wix and Squarespace sites, responsive layouts, content migrations and routine site maintenance.',
  portfolio: '', fictional: true
};
export const SAMPLE_JOBS = [
  {id:'sample-1', title:'Shopify Theme Developer', company:'Studio North', initials:'SN', color:'mint', location:'Remote', type:'Full-time', salary:'$1,200–1,800 / month', years:2, skills:['Shopify','Liquid','HTML','CSS','JavaScript'], description:'Customize Shopify themes, build responsive storefront sections and resolve storefront issues. Two years of Shopify experience and a portfolio of theme projects requested.', posted:'Sample listing', sample:true},
  {id:'sample-2', title:'WordPress & Elementor Developer', company:'Paperplane Digital', initials:'PD', color:'peach', location:'Remote', type:'Contract', salary:'$18–25 / hour', years:2, skills:['WordPress','Elementor','CSS','Responsive design'], description:'Build accessible, responsive WordPress websites from design files using Elementor. Maintain existing client sites and collaborate with a small design team.', posted:'Sample listing', sample:true},
  {id:'sample-3', title:'CMS Website Developer', company:'Fieldwork Agency', initials:'FA', color:'blue', location:'Hybrid', type:'Full-time', salary:'Salary not specified', years:3, skills:['WordPress','Shopify','HTML','CSS','PHP'], description:'Maintain a portfolio of CMS websites, implement theme changes and support e-commerce clients. Requires three years of experience and working PHP knowledge. Hybrid location eligibility must be checked.', posted:'Sample listing', sample:true},
  {id:'sample-4', title:'Wix Website Designer & Developer', company:'Olive Creative', initials:'OC', color:'olive', location:'Remote', type:'Freelance', salary:'$400–700 / project', years:2, skills:['Wix','CSS','Responsive design'], description:'Build and refresh Wix websites for small businesses. Strong responsive layout skills and attention to detail required. Availability and project scope need confirmation.', posted:'Sample listing', sample:true},
  {id:'sample-5', title:'Squarespace Website Developer', company:'Forma Studio', initials:'FS', color:'rose', location:'Remote', type:'Contract', salary:'$20–30 / hour', years:2, skills:['Squarespace','HTML','CSS','JavaScript'], description:'Create portfolio and business websites in Squarespace, customize layouts and migrate existing content. Experience adding custom CSS and JavaScript required.', posted:'Sample listing', sample:true},
  {id:'sample-6', title:'WooCommerce Developer', company:'Good Commerce', initials:'GC', color:'mint', location:'Remote', type:'Full-time', salary:'Salary not specified', years:2, skills:['WordPress','WooCommerce','PHP','CSS'], description:'Maintain WooCommerce stores, troubleshoot plugins and customize checkout flows. Requires PHP development experience; payment integration experience is a plus.', posted:'Sample listing', sample:true},
  {id:'sample-7', title:'Senior Shopify Engineer', company:'Atlas Collective', initials:'AC', color:'blue', location:'Remote', type:'Full-time', salary:'$4,000–5,000 / month', years:5, skills:['Shopify','Liquid','React','TypeScript','GraphQL'], description:'Lead advanced Shopify storefront development with React, TypeScript and GraphQL. Requires five years of experience. This role deliberately illustrates a weaker match for the sample profile.', posted:'Sample listing', sample:true},
  {id:'sample-8', title:'Website Maintenance Developer', company:'Little Oak Web', initials:'LO', color:'peach', location:'Remote', type:'Part-time', salary:'$15–22 / hour', years:1, skills:['WordPress','HTML','CSS','JavaScript'], description:'Maintain WordPress websites, update content, fix layout issues and support routine releases. Requires clear communication and a practical approach to debugging.', posted:'Sample listing', sample:true}
];
export function matchJob(job, profile) {
  const known = new Set(profile.skills.map(s => s.toLowerCase().trim()));
  const matched = job.skills.filter(s => known.has(s.toLowerCase().trim()));
  const missing = job.skills.filter(s => !known.has(s.toLowerCase().trim()));
  const skillScore = job.skills.length ? matched.length / job.skills.length : 0;
  const experienceScore = job.years > 0 ? Math.min(1, profile.years / job.years) : 1;
  const experienceKnown=job.experienceKnown!==false;
  return {score:Math.round(experienceKnown?80*skillScore+20*experienceScore:100*skillScore), matched, missing, experienceKnown,experienceGap:experienceKnown?Math.max(0,job.years-profile.years):null};
}
export function draftFor(job, profile) {
  const fit = matchJob(job,profile);
  const skills = fit.matched.length ? fit.matched.join(', ') : '[Add relevant, verified skills]';
  return `Dear ${job.company} hiring team,\n\nI am applying for the ${job.title} position. I have ${profile.years} years of experience in CMS development, with relevant skills in ${skills}.\n\n${profile.summary}\n\nI would welcome the opportunity to discuss how my experience could support your team.${profile.portfolio ? '\n\nPortfolio: '+profile.portfolio : '\n\n[Add a real portfolio link before sending.]'}\n\nThank you for your consideration.\n${profile.name}`;
}
export function profileText(p) {return `${p.fictional?'FICTIONAL SAMPLE CV — replace before real applications\n\n':''}${profilePlainText(p)}`;}
