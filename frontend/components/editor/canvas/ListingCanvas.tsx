'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Home,
  Shield,
  CheckCircle2,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  KeyRound,
  UtensilsCrossed,
  WashingMachine,
  Landmark,
  FileCheck2,
  Scale,
  Building2,
  DollarSign,
  TrendingUp,
  CalendarClock,
  Percent,
  Banknote,
  SplitSquareHorizontal,
  Plug,
  User,
  Mail,
  Clock,
  Image as ImageIcon,
  Video,
  Car,
  Trees,
  ThermometerSun,
  Sofa,
  MapPinned,
  Plus,
  PencilLine,
  Calendar,
  Dog,
  MessageCircle,
} from 'lucide-react';
import type {
  ListingDraft,
  ListingFieldMeta,
  ListingFieldKey,
  FieldMeta,
} from '@/lib/types/listing';

interface ListingCanvasProps {
  listing: ListingDraft;
  fieldMeta: ListingFieldMeta;
  onFieldUpdate: (fieldKey: string, value: any) => void;
}

// ── Inline Editable Field ──

interface EditableProps {
  value: any;
  fieldKey: string;
  meta?: FieldMeta;
  required?: boolean;
  placeholder?: string;
  type?: 'text' | 'number' | 'currency' | 'percent' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
  onUpdate: (key: string, val: any) => void;
  className?: string;
  children?: React.ReactNode;
  compact?: boolean;
  naked?: boolean;
  suffix?: string;
}

function Editable({
  value,
  fieldKey,
  meta,
  required = false,
  placeholder = 'Click to add...',
  type = 'text',
  options,
  onUpdate,
  className = '',
  children,
  compact = false,
  naked = false,
  suffix,
}: EditableProps) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value?.toString() || '');
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    setLocalVal(value?.toString() || '');
  }, [value]);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const isEmpty = value === null || value === undefined || value === '';
  const isAutoFilled = meta?.status === 'auto-filled';

  const save = () => {
    setEditing(false);
    let parsed: any = localVal;
    if (type === 'number' || type === 'currency' || type === 'percent')
      parsed = parseFloat(localVal) || null;
    if (type === 'boolean') parsed = localVal === 'true';
    onUpdate(fieldKey, parsed);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      setLocalVal(value?.toString() || '');
      setEditing(false);
    }
  };

  // Render the editable wrapper
  return (
    <span
      className={`group/edit relative inline-flex items-center cursor-pointer transition-all rounded-md ${
        editing
          ? 'ring-2 ring-brand-500/40 bg-white shadow-sm'
          : isEmpty
            ? 'border border-dashed border-surface-300 bg-surface-50/60 hover:border-brand-400 hover:bg-brand-50/30'
            : isAutoFilled
              ? 'hover:ring-1 hover:ring-brand-300'
              : 'hover:ring-1 hover:ring-surface-300'
      } ${className}`}
      onClick={() => !editing && setEditing(true)}
    >
      {editing ? (
        type === 'select' && options ? (
          <select
            ref={ref as React.RefObject<HTMLSelectElement>}
            value={localVal}
            onChange={(e) => {
              setLocalVal(e.target.value);
              const v =
                e.target.value === 'true'
                  ? true
                  : e.target.value === 'false'
                    ? false
                    : e.target.value;
              onUpdate(fieldKey, v);
              setEditing(false);
            }}
            onBlur={save}
            className="bg-transparent outline-none text-inherit font-inherit px-1"
          >
            <option value="">Select...</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            type={
              type === 'currency' || type === 'number' || type === 'percent' ? 'number' : 'text'
            }
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={save}
            onKeyDown={handleKey}
            className="bg-transparent outline-none text-inherit font-inherit w-full px-1"
            placeholder={placeholder}
          />
        )
      ) : isEmpty ? (
        <span className="text-surface-400 italic px-2 py-0.5 text-sm flex items-center gap-1">
          {required && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
          {placeholder}
        </span>
      ) : (
        <>
          {children || (
            <span className={compact ? '' : 'px-1'}>
              {type === 'currency'
                ? `$${Number(value).toLocaleString()}`
                : type === 'percent'
                  ? `${value}%`
                  : type === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : options
                      ? options.find((o) => o.value === String(value))?.label || value
                      : value}
              {suffix}
            </span>
          )}
          {isAutoFilled && (
            <CheckCircle2
              className={`w-3 h-3 text-brand-500 ml-1 opacity-0 group-hover/edit:opacity-100 transition-opacity shrink-0 mt-1 ${compact ? 'hidden' : ''}`}
            />
          )}
        </>
      )}
      {!editing && !(naked && isEmpty) && (
        <PencilLine
          className={`w-3 h-3 text-surface-400 ml-1 opacity-0 group-hover/edit:opacity-100 transition-opacity shrink-0 mt-1 ${compact ? 'hidden' : ''}`}
        />
      )}
    </span>
  );
}

// ── Auto-fill badge (small) ──
function AutoBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-brand-500 ml-1">
      <CheckCircle2 className="w-2.5 h-2.5" />
    </span>
  );
}

// ── Main Canvas Component ──

export function ListingCanvas({ listing, fieldMeta, onFieldUpdate }: ListingCanvasProps) {
  const heroInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const gallerySlotRef = useRef<number>(0);

  const e = (key: ListingFieldKey) => ({
    value: listing[key],
    fieldKey: key,
    meta: fieldMeta[key],
    onUpdate: onFieldUpdate,
  });

  const REQ = [
    'heroImage',
    'bedrooms',
    'bathrooms',
    'privateEntrance',
    'kitchenType',
    'inUnitLaundry',
    'leaseTerm',
    'utilitiesStrategy',
    'contactPreference',
  ] as ListingFieldKey[];
  const isRequired = (k: ListingFieldKey) => REQ.includes(k);

  const handleHeroUpload = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        onFieldUpdate('heroImage', e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    ev.target.value = ''; // reset so same file can be re-selected
  };

  const handleGalleryUpload = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const newGallery = [...(listing.imageGallery || [])];
        const slot = gallerySlotRef.current;
        if (slot < newGallery.length) {
          newGallery[slot] = e.target.result as string;
        } else {
          newGallery.push(e.target.result as string);
        }
        onFieldUpdate('imageGallery', newGallery);
      }
    };
    reader.readAsDataURL(file);
    ev.target.value = '';
  };

  return (
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
      {/* Hidden file inputs */}
      <input
        ref={heroInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleHeroUpload}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleGalleryUpload}
      />

      {/* ━━━ PHOTO GALLERY ━━━ */}
      <div className="relative">
        <div className="grid grid-cols-4 grid-rows-2 gap-1 h-[340px]">
          {/* Hero image — large */}
          <div
            className="col-span-2 row-span-2 relative bg-surface-100 cursor-pointer group overflow-hidden"
            onClick={() => heroInputRef.current?.click()}
          >
            {listing.heroImage ? (
              <>
                <img src={listing.heroImage} alt="Hero" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                  <Camera className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-surface-400 border-2 border-dashed border-surface-200 m-1 rounded-xl hover:border-brand-400 hover:bg-brand-50/20 transition-all">
                <Camera className="w-10 h-10 mb-2 text-surface-300" />
                <span className="text-sm font-semibold">Add Hero Photo</span>
                <span className="text-xs text-surface-400 mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Required
                </span>
              </div>
            )}
            {listing.aduType && (
              <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm text-surface-900 text-xs font-bold px-2.5 py-1 rounded-full shadow-sm border border-surface-200">
                🏠 ADU Rental
              </span>
            )}
          </div>
          {/* Additional photos grid */}
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="relative bg-surface-100 cursor-pointer group overflow-hidden"
              onClick={() => {
                gallerySlotRef.current = i;
                galleryInputRef.current?.click();
              }}
            >
              {listing.imageGallery?.[i] ? (
                <>
                  <img
                    src={listing.imageGallery[i]}
                    alt={`Photo ${i + 2}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-surface-300 hover:text-brand-400 hover:bg-brand-50/20 transition-all">
                  <Plus className="w-6 h-6" />
                </div>
              )}
              {i === 3 && (listing.imageGallery?.length || 0) > 4 && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm font-bold">
                  +{listing.imageGallery.length - 4} more
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ━━━ PRICE + KEY STATS ━━━ */}
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* Monthly rent - large */}
            <div className="flex items-baseline gap-1 mb-1">
              <Editable
                {...e('monthlyRent')}
                type="currency"
                placeholder="Set monthly rent"
                className="text-3xl font-extrabold text-surface-900 tracking-tight"
              />
              <span className="text-lg text-surface-400 font-medium">/mo</span>
            </div>

            {/* Address */}
            <div className="flex items-center text-surface-600 text-[15px] gap-1.5 flex-wrap mt-1">
              <MapPin className="w-4 h-4 shrink-0 text-surface-400" />
              <span className="leading-normal flex items-center flex-wrap gap-x-1">
                <Editable {...e('address')} placeholder="Address" suffix="," compact />
                <Editable {...e('city')} placeholder="City" suffix="," compact />
                <span>
                  {listing.state} {listing.zipCode}
                </span>
              </span>
            </div>

            {/* Available Date */}
            <div className="flex items-center text-surface-600 text-[15px] gap-1.5 mt-2 font-medium">
              <Calendar className="w-4 h-4 shrink-0 text-brand-500" />
              <span>Available:</span>
              <Editable {...e('availableDate')} placeholder="Set date" className="text-brand-600" />
            </div>
          </div>
          {/* Key stats - right aligned */}
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-6 ml-8">
              <div className="text-center">
                <Editable
                  {...e('bedrooms')}
                  required
                  type="number"
                  placeholder="—"
                  className="text-2xl font-bold text-surface-900"
                />
                <div className="text-xs text-surface-500 font-semibold mt-0.5">beds</div>
              </div>
              <div className="w-px h-8 bg-surface-200" />
              <div className="text-center">
                <Editable
                  {...e('bathrooms')}
                  required
                  type="number"
                  placeholder="—"
                  className="text-2xl font-bold text-surface-900"
                />
                <div className="text-xs text-surface-500 font-semibold mt-0.5">baths</div>
              </div>
              <div className="w-px h-8 bg-surface-200" />
              <div className="text-center">
                <Editable
                  {...e('sqft')}
                  required
                  type="number"
                  placeholder="—"
                  className="text-2xl font-bold text-surface-900"
                />
                <div className="text-xs text-surface-500 font-semibold mt-0.5">sqft</div>
              </div>
            </div>

            {/* Request a Tour Button */}
            <div className="mt-4 w-full pl-8">
              <button className="w-full flex items-center justify-center gap-2 bg-[#2EBD59] hover:bg-[#28a74e] text-white font-medium text-[15px] py-2.5 px-4 rounded-xl shadow-[0_2px_8px_rgba(46,189,89,0.25)] hover:shadow-[0_4px_16px_rgba(46,189,89,0.35)] active:scale-[0.98] transition-all duration-200 cursor-pointer">
                <MessageCircle className="w-5 h-5 fill-white/10" />
                Enter Contact Info
              </button>
            </div>
          </div>
        </div>

        {/* Security deposit line */}
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="bg-brand-50 text-brand-700 font-bold px-2 py-0.5 rounded-md text-xs border border-brand-200">
            Deposit:{' '}
            <Editable
              {...e('securityDeposit')}
              type="currency"
              placeholder="Set deposit"
              className="text-xs font-bold text-brand-700"
            />
          </span>
        </div>
      </div>

      {/* ━━━ PROPERTY DETAIL CHIPS ━━━ */}
      <div className="px-8 pb-5">
        <div className="grid grid-cols-2 gap-2">
          <DetailChip
            icon={Building2}
            label="ADU Type"
            editable={
              <Editable
                {...e('aduType')}
                type="select"
                placeholder="Select type"
                options={[
                  { value: 'detached', label: 'Detached' },
                  { value: 'attached', label: 'Attached' },
                  { value: 'garage_conversion', label: 'Garage Conversion' },
                  { value: 'junior_adu', label: 'Junior ADU' },
                  { value: 'above_garage', label: 'Above Garage' },
                  { value: 'basement', label: 'Basement' },
                ]}
                className="text-sm font-semibold text-surface-900"
              />
            }
          />
          <DetailChip
            icon={KeyRound}
            label="Entrance"
            editable={
              <Editable
                {...e('privateEntrance')}
                required
                type="select"
                placeholder="Select"
                options={[
                  { value: 'true', label: 'Private' },
                  { value: 'false', label: 'Shared' },
                ]}
                className="text-sm font-semibold text-surface-900"
              />
            }
          />
          <DetailChip
            icon={Sofa}
            label="Furnished"
            editable={
              <Editable
                {...e('furnished')}
                type="select"
                placeholder="Select"
                options={[
                  { value: 'fully', label: 'Fully Furnished' },
                  { value: 'partially', label: 'Partially Furnished' },
                  { value: 'unfurnished', label: 'Unfurnished' },
                ]}
                className="text-sm font-semibold text-surface-900"
              />
            }
          />
          <DetailChip
            icon={ThermometerSun}
            label="Climate"
            editable={
              <Editable
                {...e('climateControl')}
                type="select"
                placeholder="Select"
                options={[
                  { value: 'mini_split', label: 'Mini-Split (AC/Heat)' },
                  { value: 'central', label: 'Central Air' },
                  { value: 'window_unit', label: 'Window Unit' },
                  { value: 'none', label: 'None' },
                ]}
                className="text-sm font-semibold text-surface-900"
              />
            }
          />
          <DetailChip
            icon={Trees}
            label="Outdoor"
            editable={
              <Editable
                {...e('outdoorSpace')}
                type="select"
                placeholder="Select"
                options={[
                  { value: 'private_yard', label: 'Private Yard' },
                  { value: 'shared_yard', label: 'Shared Yard' },
                  { value: 'patio', label: 'Patio/Deck' },
                  { value: 'none', label: 'None' },
                ]}
                className="text-sm font-semibold text-surface-900"
              />
            }
          />
        </div>
      </div>

      <div className="border-t border-surface-100 mx-8" />

      {/* ━━━ UNIT DETAILS ━━━ */}
      <div className="px-8 py-5">
        <h3 className="text-lg font-bold text-surface-900 mb-3 tracking-tight">Unit Details</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <DetailRow icon={UtensilsCrossed} label="Kitchen">
            <Editable
              {...e('kitchenType')}
              required
              type="select"
              placeholder="Select kitchen type"
              options={[
                { value: 'full', label: 'Full Kitchen' },
                { value: 'kitchenette', label: 'Kitchenette' },
                { value: 'none', label: 'No Kitchen' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={WashingMachine} label="Laundry">
            <Editable
              {...e('inUnitLaundry')}
              required
              type="select"
              placeholder="Select laundry"
              options={[
                { value: 'in_unit', label: 'In-Unit W/D' },
                { value: 'hookups', label: 'Hookups Only' },
                { value: 'shared', label: 'Shared' },
                { value: 'none', label: 'None' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={Plug} label="Utilities">
            <Editable
              {...e('utilitiesStrategy')}
              required
              type="select"
              placeholder="Select strategy"
              options={[
                { value: 'separate', label: 'Separate Meters' },
                { value: 'shared', label: 'Shared' },
                { value: 'included', label: 'Included in Rent' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={SplitSquareHorizontal} label="Lease Term">
            <Editable
              {...e('leaseTerm')}
              required
              type="select"
              placeholder="Select term"
              options={[
                { value: 'month_to_month', label: 'Month-to-Month' },
                { value: '6_month', label: '6 Months' },
                { value: '1_year', label: '1 Year' },
                { value: '2_year', label: '2 Years' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={Dog} label="Pet Policy">
            <Editable
              {...e('petPolicy')}
              placeholder="e.g. Small dogs allowed"
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={Plug} label="Utilities Included">
            <Editable
              {...e('utilitiesIncluded')}
              placeholder="e.g. Water, Trash"
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
        </div>
      </div>

      <div className="border-t border-surface-100 mx-8" />

      {/* ━━━ DESCRIPTION ("What's special") ━━━ */}
      <div className="px-8 py-5">
        <h3 className="text-lg font-bold text-surface-900 mb-3 tracking-tight">
          What&apos;s Special
        </h3>
        <Editable
          {...e('description')}
          placeholder="Click to write a description, or ask the AI agent to generate one..."
          className="text-surface-600 text-sm leading-relaxed font-medium w-full min-h-[60px] py-2 px-3 block"
        />
      </div>

      <div className="border-t border-surface-100 mx-8" />

      {/* ━━━ FINANCIALS / INVESTOR METRICS ━━━ */}
      <div className="px-8 py-5">
        <h3 className="text-lg font-bold text-surface-900 mb-3 tracking-tight">
          Investment Overview
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Cap Rate" icon={Percent}>
            <Editable
              {...e('capRate')}
              type="percent"
              placeholder="—"
              className="text-xl font-bold text-surface-900"
            />
          </MetricCard>
          <MetricCard label="Gross Yield" icon={TrendingUp}>
            <Editable
              {...e('grossYield')}
              type="percent"
              placeholder="—"
              className="text-xl font-bold text-surface-900"
            />
          </MetricCard>
          <MetricCard label="Payback" icon={CalendarClock}>
            <span className="flex items-baseline gap-0.5">
              <Editable
                {...e('paybackPeriod')}
                type="number"
                placeholder="—"
                className="text-xl font-bold text-surface-900"
              />
              <span className="text-xs text-surface-400 font-medium">yrs</span>
            </span>
          </MetricCard>
          <MetricCard label="Build Cost" icon={Banknote}>
            <Editable
              {...e('constructionCost')}
              type="currency"
              placeholder="—"
              className="text-xl font-bold text-surface-900"
            />
          </MetricCard>
        </div>
      </div>

      <div className="border-t border-surface-100 mx-8" />

      {/* ━━━ SELLER / CONTACT ━━━ */}
      <div className="px-8 py-5">
        <h3 className="text-lg font-bold text-surface-900 mb-3 tracking-tight">Contact</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <DetailRow icon={User} label="Seller Type">
            <Editable
              {...e('sellerType')}
              type="select"
              placeholder="Select"
              options={[
                { value: 'homeowner', label: 'Homeowner' },
                { value: 'investor', label: 'Investor' },
                { value: 'developer', label: 'Developer' },
                { value: 'property_manager', label: 'Property Manager' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={Mail} label="Contact Via">
            <Editable
              {...e('contactPreference')}
              required
              type="select"
              placeholder="Select"
              options={[
                { value: 'email', label: 'Email' },
                { value: 'phone', label: 'Phone' },
                { value: 'in_app', label: 'In-App' },
                { value: 'any', label: 'Any' },
              ]}
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
          <DetailRow icon={Clock} label="Response Time">
            <Editable
              {...e('responseTime')}
              placeholder="e.g. Within 24 hours"
              className="text-sm font-semibold text-surface-900"
            />
          </DetailRow>
        </div>
      </div>

      <div className="border-t border-surface-100 mx-8" />

      {/* ━━━ OPTIONAL FEATURES ━━━ */}
      <div className="px-8 py-5">
        <h3 className="text-sm font-bold text-surface-400 uppercase tracking-wider mb-3">
          Optional — Boost Your Listing
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <OptionalChip icon={Car} label="Parking">
            <Editable {...e('parkingDetails')} placeholder="Add parking info" className="text-xs" />
          </OptionalChip>
          <OptionalChip icon={Trees} label="Outdoor Space">
            <Editable {...e('outdoorSpace')} placeholder="Add outdoor space" className="text-xs" />
          </OptionalChip>
          <OptionalChip icon={ThermometerSun} label="Climate">
            <Editable
              {...e('climateControl')}
              type="select"
              placeholder="Select"
              options={[
                { value: 'mini_split', label: 'Mini-Split' },
                { value: 'central', label: 'Central HVAC' },
                { value: 'window_unit', label: 'Window Unit' },
                { value: 'none', label: 'None' },
              ]}
              className="text-xs"
            />
          </OptionalChip>
          <OptionalChip icon={Sofa} label="Furnished">
            <Editable
              {...e('furnished')}
              type="select"
              placeholder="Select"
              options={[
                { value: 'unfurnished', label: 'Unfurnished' },
                { value: 'partially', label: 'Partial' },
                { value: 'fully', label: 'Fully Furnished' },
              ]}
              className="text-xs"
            />
          </OptionalChip>
          <OptionalChip icon={MapPinned} label="Nearby">
            <Editable
              {...e('proximityToEmployers')}
              placeholder="e.g. Near UCI"
              className="text-xs"
            />
          </OptionalChip>
          <OptionalChip icon={Shield} label="STR Allowed">
            <Editable
              {...e('shortTermRentalAllowed')}
              type="select"
              placeholder="Select"
              options={[
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ]}
              className="text-xs"
            />
          </OptionalChip>
        </div>
      </div>

      {/* ━━━ FOOTER META ━━━ */}
      <div className="px-8 py-4 bg-surface-50 border-t border-surface-100">
        <div className="flex items-center gap-4 text-xs text-surface-400 font-medium">
          <span>APN: {listing.apn || '—'}</span>
          <span className="text-surface-200">|</span>
          <span>
            {listing.neighborhood || listing.city}, {listing.state}
          </span>
          <span className="text-surface-200">|</span>
          <span>Listing created {new Date(listing.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── Sub-Components ──

function DetailChip({
  icon: Icon,
  label,
  editable,
}: {
  icon: React.ElementType;
  label: string;
  editable: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-surface-200 bg-surface-50/50 hover:bg-surface-50 transition-colors">
      <Icon className="w-4 h-4 text-surface-400 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-surface-400 mb-0.5">
          {label}
        </div>
        {editable}
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className="w-4 h-4 text-surface-400 shrink-0" />
      <span className="text-sm text-surface-500 font-medium w-28 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-50 rounded-xl p-3 border border-surface-200 text-center">
      <Icon className="w-4 h-4 text-surface-400 mx-auto mb-1" />
      <div className="mb-0.5">{children}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-surface-400">{label}</div>
    </div>
  );
}

function OptionalChip({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-surface-200 hover:border-surface-300 transition-colors bg-white">
      <Icon className="w-3.5 h-3.5 text-surface-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold text-surface-400 mb-0.5">{label}</div>
        {children}
      </div>
    </div>
  );
}
