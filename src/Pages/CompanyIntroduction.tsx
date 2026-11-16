import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Droplets, MapPin, Phone, Recycle, Smartphone } from 'lucide-react';
import BottomNavV0 from '../Components/BottomNavV0';
import LanguageSwitcher from '../Components/LanguageSwitcher';
import CompanyActivities from '../Components/CompanyActivities';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { useCompanyContent } from '../content/useCompanyContent';
import { COMPANY_BUCKET, companyImageUrl, companyPhoneHref } from '../content/companySchema';
import { supabase } from '../supabaseClient';
import './CompanyIntroduction.css';

const serviceIcons = [Droplets, Smartphone, Recycle];

export default function CompanyIntroduction({ customer }: { customer: { customer_type: string } | null }) {
  const { language } = useLanguage();
  const { tokens, isDark } = useColorTokens();
  const content = useCompanyContent();
  const copy = content.profiles[language];
  const imageUrl = (path: string) => companyImageUrl(path, key => supabase.storage.from(COMPANY_BUCKET).getPublicUrl(key).data.publicUrl);
  const home = customer ? '/customer-home' : '/';

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    const previous = document.title;
    document.title = `${copy.pageTitle} | VIVIDAQUA`;
    return () => { document.title = previous; };
  }, [copy.pageTitle]);

  const colors = {
    '--company-background': isDark ? tokens.pageBg : 'linear-gradient(155deg, #eaf7f9 0%, #c0e5e9 45%, #e2f4f6 100%)',
    '--company-text': tokens.text,
    '--company-muted': tokens.muted,
    '--company-card': tokens.card,
    '--company-border': tokens.primaryBorder,
    '--company-primary': tokens.primary,
    '--company-tint': tokens.primaryBg,
  } as CSSProperties;

  return (
    <div className="company-page" style={colors}>
      <header className="company-header">
        <Link to={home} className="company-back"><ArrowLeft size={17} aria-hidden="true" />{copy.back}</Link>
        <Link to={home} className="company-brand" aria-label="VIVIDAQUA"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="VIVIDAQUA" width="144" height="33" /></Link>
        <LanguageSwitcher />
      </header>

      <main className="company-main">
        <section className="company-hero" aria-labelledby="company-title">
          <div className="company-hero-copy">
            <p className="company-eyebrow">{copy.eyebrow}</p>
            <h1 id="company-title">{copy.headline}</h1>
            <p className="company-introduction">{copy.introduction}</p>
            <div className="company-actions">
              <Link to="/place-order" className="company-button company-button-solid">{copy.order}<ArrowUpRight size={19} aria-hidden="true" /></Link>
              <a href="#company-story" className="company-text-link">{copy.discover}<span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <div className="company-hero-art">
            <span className="company-orbit company-orbit-one" aria-hidden="true" />
            <span className="company-orbit company-orbit-two" aria-hidden="true" />
            <img src={imageUrl(content.images.hero)} alt={copy.heroAlt} width="640" height="679" fetchPriority="high" />
          </div>
          <div className="company-pillars">{copy.pillars.map((pillar, index) => <span key={pillar}><span className="company-pillar-number" aria-hidden="true">0{index + 1}</span>{pillar}</span>)}</div>
        </section>

        <section id="company-story" className="company-story" aria-labelledby="company-story-title">
          <div><p className="company-section-label">{copy.aboutLabel}</p><h2 id="company-story-title">{copy.aboutTitle}</h2></div>
          <div className="company-story-body"><p>{copy.aboutBody}</p><p>{copy.mission}</p></div>
        </section>

        <section className="company-services" aria-labelledby="company-services-title">
          <p className="company-section-label">{copy.servicesLabel}</p>
          <h2 id="company-services-title">{copy.servicesTitle}</h2>
          <div className="company-service-grid">
            {copy.services.map((service, index) => {
              const Icon = serviceIcons[index];
              return <article key={service.title} className="company-service-card"><span className="company-service-icon"><Icon size={23} aria-hidden="true" /></span><h3>{service.title}</h3><p>{service.body}</p></article>;
            })}
          </div>
        </section>

        <section className="company-gallery" aria-labelledby="company-gallery-title">
          <p className="company-section-label">{copy.galleryLabel}</p>
          <h2 id="company-gallery-title">{copy.galleryTitle}</h2>
          <p className="company-section-description">{copy.galleryBody}</p>
          <div className="company-gallery-grid">{content.images.gallery.map((image, index) => <figure key={image}><img src={imageUrl(image)} alt={`${copy.galleryAlt} ${index + 1}`} width="400" height="480" loading="lazy" /></figure>)}</div>
        </section>

        <CompanyActivities activities={content.activities} language={language} imageUrl={imageUrl} />

        <section className="company-contact" aria-labelledby="company-contact-title">
          <div><p className="company-section-label">{copy.contactLabel}</p><h2 id="company-contact-title">{copy.contactTitle}</h2><p>{copy.contactBody}</p></div>
          <div className="company-contact-details">
            <a href={companyPhoneHref(content.contact.phone)} className="company-contact-row"><Phone size={20} aria-hidden="true" /><span><span className="company-contact-label">{copy.phoneLabel}</span><strong>{content.contact.phone}</strong></span><ArrowUpRight size={18} aria-hidden="true" /></a>
            <div className="company-contact-row"><MapPin size={20} aria-hidden="true" /><span><span className="company-contact-label">{copy.addressLabel}</span><address>{content.contact.address}</address></span></div>
          </div>
        </section>

        <footer className="company-footer"><span>© {new Date().getFullYear()} VIVIDAQUA</span><Link to={home}>{copy.back}<ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
      </main>
      {customer && <BottomNavV0 customer={customer} />}
    </div>
  );
}
