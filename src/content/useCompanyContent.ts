import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { defaultCompanyDocument } from './companyDefaults';
import { isCompanyRecord } from './companySchema';

export function useCompanyContent() {
  const [content, setDocument] = useState(defaultCompanyDocument);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_company_page_content');
        if (active && !error && isCompanyRecord(data)) setDocument(data.document);
      } catch { /* Keep the bundled introduction available during service failures. */ }
    };
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return content;
}
