// BranchSelection.tsx
// Shown once to new customers (branch === 'Pending') to pick their service branch.
// Uses Google Places Autocomplete — requires Maps JavaScript API + Places API.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useJsApiLoader,
  GoogleMap,
  Marker,
  InfoWindow,
  Autocomplete,
} from '@react-google-maps/api';
import { supabase } from '../supabaseClient';
import { theme } from '../theme';
import toast from 'react-hot-toast';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

// Must be stable reference outside component to avoid Maps re-loading
const LIBRARIES: ('places')[] = ['places'];

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  service_radius_km: number;
}

interface BranchWithDistance extends Branch {
  distance: number;
}

interface Props {
  customer: { id: string; name: string; address: string; customer_type?: string | null };
  mode?: 'setup' | 'edit';
}

// ─── Haversine distance (km) ───────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MAP_CONTAINER_STYLE = { width: '100%', height: '260px' };
const DEFAULT_CENTER = { lat: -6.2, lng: 106.816 };
const CUSTOMER_ICON = { url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' };
const BRANCH_ICON = (selected: boolean) => ({
  url: selected
    ? 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
    : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
});

export default function BranchSelection({ customer, mode = 'setup' }: Props) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY, libraries: LIBRARIES });
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { tokens } = useColorTokens();

  const [branches, setBranches] = useState<BranchWithDistance[]>([]);
  const [customerCoords, setCustomerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [selectedBranch, setSelectedBranch] = useState<BranchWithDistance | null>(null);
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(true);

  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  const customerTypeNorm = (customer.customer_type || '').toLowerCase();
  const isLaterPayLocked =
    customerTypeNorm === 'later_pay' || customerTypeNorm === 'later_paid';

  useEffect(() => {
    if (!isLaterPayLocked) return;
    if (mode === 'edit') {
      toast.error(t('branch.laterPayCannotChange'));
    } else {
      toast.error(t('branch.laterPaySetupAnomaly'));
    }
    navigate('/account', { replace: true });
  }, [isLaterPayLocked, mode, navigate, t]);

  // ─── Fetch branches on mount ────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('branches')
      .select('id, name, address, phone, latitude, longitude, service_radius_km')
      .eq('status', 'active')
      .then(({ data }) => {
        const valid = (data || []).filter(
          (b) => b.latitude != null && b.longitude != null
        ) as Branch[];
        setBranches(valid.map((b) => ({ ...b, service_radius_km: b.service_radius_km ?? 10, distance: 0 })));
        // Center map on first branch
        if (valid.length > 0) setMapCenter({ lat: valid[0].latitude, lng: valid[0].longitude });
        setLoadingBranches(false);
      });
  }, []);

  // ─── Recalculate distances when customer location is set ────────────────
  const applyCoords = (coords: { lat: number; lng: number }) => {
    setCustomerCoords(coords);
    setMapCenter(coords);
    setBranches((prev) =>
      prev
        .map((b) => ({ ...b, distance: haversineKm(coords.lat, coords.lng, b.latitude, b.longitude) }))
        .sort((a, b) => a.distance - b.distance)
    );
    setSelectedBranch(null);
  };

  // ─── Places autocomplete callback ───────────────────────────────────────
  const onPlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const lat = place.geometry?.location?.lat();
    const lng = place.geometry?.location?.lng();
    if (lat !== undefined && lng !== undefined) {
      applyCoords({ lat, lng });
    }
  };

  // ─── Nearby = within radius, or all if none qualify ────────────────────
  const nearbyBranches = customerCoords
    ? branches.filter((b) => b.distance <= b.service_radius_km)
    : [];
  const displayBranches = nearbyBranches.length > 0 ? nearbyBranches : branches;
  const showingAll = nearbyBranches.length === 0;

  // ─── Confirm selection ──────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!selectedBranch) return;
    setSaving(true);

    const token = sessionStorage.getItem('auth_token');
    if (!token) {
      toast.error(t('branch.sessionExpired'));
      setSaving(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke('update-customer-branch', {
      body: { token, branch_name: selectedBranch.name },
    });

    if (error || !data?.success) {
      toast.error(t('branch.saveFailed'));
      setSaving(false);
      return;
    }

    const stored = sessionStorage.getItem('customer');
    if (stored) {
      sessionStorage.setItem(
        'customer',
        JSON.stringify({ ...JSON.parse(stored), branch: selectedBranch.name })
      );
    }
    window.dispatchEvent(new Event('session-auth-updated'));
    toast.success(`Branch set to ${selectedBranch.name}!`);
    if (mode === 'edit') {
      navigate(-1);
    }
  };

  if (isLaterPayLocked) {
    return (
      <div style={{
        minHeight: '100vh', background: tokens.pageBg,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', color: tokens.text, gap: '16px',
      }}>
        <div style={{
          width: '48px', height: '48px',
          border: `4px solid ${tokens.primaryBorder}`,
          borderTop: `4px solid ${tokens.primary}`, borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─── Loading state ──────────────────────────────────────────────────────
  if (!isLoaded || loadingBranches) {
    return (
      <div style={{
        minHeight: '100vh', background: tokens.pageBg,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', color: tokens.text, gap: '16px',
      }}>
        <div style={{
          width: '48px', height: '48px',
          border: `4px solid ${tokens.primaryBorder}`,
          borderTop: `4px solid ${tokens.primary}`, borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: '16px', fontWeight: '500' }}>{t('branch.loading')}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: tokens.pageBg, paddingBottom: '88px' }}>

      {/* Header */}
      <div style={{ padding: '20px 16px 12px', background: 'rgba(0,0,0,0.30)', borderBottom: `1px solid ${tokens.cardBorder}`, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
        {mode === 'edit' && (
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600',
              padding: '8px 14px',
              borderRadius: '20px',
              cursor: 'pointer',
              marginBottom: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            &larr; {t('common.back')}
          </button>
        )}
        <h1 style={{ color: 'white', fontSize: '22px', fontWeight: '700', margin: '0 0 4px', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
          💧 {t('branch.title')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', margin: 0 }}>
          Hi {customer.name}! {t('branch.greeting')}
        </p>
      </div>

      {/* Address Search Box */}
      <div style={{ padding: '0 16px 8px' }}>
        <Autocomplete
          onLoad={(ac) => setAutocomplete(ac)}
          onPlaceChanged={onPlaceChanged}
          options={{ componentRestrictions: { country: 'id' } }}
        >
          <input
            type="text"
            defaultValue={customer.address}
            placeholder={t('branch.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '13px 16px',
              fontSize: '14px',
              border: 'none',
              borderRadius: '12px',
              boxSizing: 'border-box',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              outline: 'none',
            }}
          />
        </Autocomplete>
        {!customerCoords && (
          <p style={{ color: tokens.muted, fontSize: '12px', margin: '6px 0 0 4px' }}>
            {t('branch.searchHint')}
          </p>
        )}
      </div>

      {/* Map */}
      <div style={{ margin: '0 16px 8px', borderRadius: '16px', overflow: 'hidden' }}>
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={mapCenter}
          zoom={customerCoords ? 12 : 11}
          options={{ disableDefaultUI: true, zoomControl: true }}
        >
          {customerCoords && (
            <Marker position={customerCoords} icon={CUSTOMER_ICON} title="Your location" />
          )}
          {displayBranches.map((branch) => (
            <Marker
              key={branch.id}
              position={{ lat: branch.latitude, lng: branch.longitude }}
              icon={BRANCH_ICON(selectedBranch?.id === branch.id)}
              title={branch.name}
              onClick={() => {
                setSelectedBranch(branch);
                setActiveMarker(branch.id);
                setMapCenter({ lat: branch.latitude, lng: branch.longitude });
              }}
            >
              {activeMarker === branch.id && (
                <InfoWindow onCloseClick={() => setActiveMarker(null)}>
                  <div style={{ fontSize: '13px', maxWidth: '160px' }}>
                    <strong>{branch.name}</strong><br />
                    {branch.address}
                    {branch.distance > 0 && (
                      <><br /><span style={{ color: '#667eea' }}>{branch.distance.toFixed(1)} {t('branch.kmAway')}</span></>
                    )}
                  </div>
                </InfoWindow>
              )}
            </Marker>
          ))}
        </GoogleMap>
      </div>

      {/* Branch list */}
      <div style={{ padding: '0 16px' }}>
        <p style={{ color: tokens.muted, fontSize: '12px', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {customerCoords
            ? showingAll
              ? `${t('branch.allBranches')} (${branches.length})`
              : `${t('branch.nearbyBranches')} (${displayBranches.length})`
            : `${t('branch.nearbyBranches')} (${displayBranches.length})`}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {displayBranches.map((branch) => {
            const isSelected = selectedBranch?.id === branch.id;
            return (
              <div
                key={branch.id}
                onClick={() => {
                  setSelectedBranch(branch);
                  setActiveMarker(branch.id);
                  setMapCenter({ lat: branch.latitude, lng: branch.longitude });
                }}
                style={{
                  background: tokens.card,
                  borderRadius: '14px',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  border: isSelected ? `2px solid ${tokens.primary}` : `1px solid ${tokens.cardBorder}`,
                  boxShadow: isSelected ? `0 4px 16px rgba(0,105,113,0.12)` : tokens.cardShadow,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 3px', fontWeight: '700', fontSize: '15px', color: isSelected ? tokens.primary : tokens.text }}>
                      {branch.name}
                    </p>
                    <p style={{ margin: '0 0 3px', fontSize: '12px', color: tokens.muted }}>
                      📍 {branch.address}
                    </p>
                    {branch.phone && (
                      <p style={{ margin: 0, fontSize: '12px', color: tokens.muted }}>
                        📞 {branch.phone}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '68px', paddingLeft: '8px' }}>
                    {branch.distance > 0 && (
                      <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: '600', color: isSelected ? tokens.primary : tokens.muted }}>
                        {branch.distance.toFixed(1)} km
                      </p>
                    )}
                    {isSelected && (
                      <span style={{ background: tokens.primary, color: 'white', fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '10px' }}>
                        ✓ {t('branch.selected')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={!selectedBranch || saving}
          style={{
            width: '100%', marginTop: '6px', padding: '14px', border: 'none',
            borderRadius: '14px', fontSize: '16px', fontWeight: '700', color: 'white',
            background: selectedBranch ? tokens.gradientPrimary : tokens.divider,
            cursor: selectedBranch && !saving ? 'pointer' : 'not-allowed',
            boxShadow: selectedBranch ? '0 4px 20px rgba(0,0,0,0.2)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {saving ? `⏳ ${t('branch.saving')}` : selectedBranch ? `✅ ${t('branch.confirm')} — ${selectedBranch.name}` : t('branch.selectAbove')}
        </button>
      </div>
    </div>
  );
}
