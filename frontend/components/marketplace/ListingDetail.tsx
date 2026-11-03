'use client';
import { useState } from 'react';
import { Listing } from '@/lib/types/listing';
import Image from 'next/image';
import { formatCurrency, formatSqft, formatDateString } from '@/lib/utils/formatting';
import { AduTypeBadge } from './AduTypeBadge';
import { PermitBadge } from './PermitBadge';
import { SaveButton } from './SaveButton';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Key,
  Wifi,
  Droplet,
  Car,
  Trash2,
  Home,
  ChefHat,
  CalendarRange,
  Sofa,
  Wind,
  Trees,
  Dog,
  Briefcase,
  Phone,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface ListingDetailProps {
  listing: Listing;
  isPreview?: boolean;
}

export function ListingDetail({ listing, isPreview = false }: ListingDetailProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const hasAmenities =
    isPreview ||
    (listing.privateEntrance !== null && listing.privateEntrance !== undefined) ||
    (listing.inUnitLaundry !== null && listing.inUnitLaundry !== undefined) ||
    (listing.parkingIncluded !== null && listing.parkingIncluded !== undefined) ||
    listing.parkingDetails ||
    (listing.kitchenType !== null && listing.kitchenType !== undefined) ||
    (listing.climateControl !== null && listing.climateControl !== undefined) ||
    (listing.furnished !== null && listing.furnished !== undefined) ||
    (listing.outdoorSpace && listing.outdoorSpace.toLowerCase() !== 'none');

  const hasLeasing =
    isPreview ||
    listing.leaseTerm ||
    listing.utilitiesStrategy ||
    listing.petPolicy ||
    listing.contactPreference;
  const hasAddress = listing.address || listing.city || listing.state || listing.zipCode;

  // Collect all images including heroImage
  const allImages = [listing.heroImage, ...(listing.images || [])].filter(Boolean) as string[];
  const uniqueImages = Array.from(new Set(allImages));

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % uniqueImages.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + uniqueImages.length) % uniqueImages.length);
  };

  return (
    <div className="bg-white min-h-screen">
      {/* Image Gallery */}
      <div
        className={`w-full h-[40vh] md:h-[60vh] relative bg-slate-100 flex items-center justify-center overflow-hidden ${isPreview && uniqueImages.length === 0 ? 'border-[3px] border-dashed border-slate-300' : ''}`}
      >
        {uniqueImages.length > 0 ? (
          <>
            <Image
              src={uniqueImages[currentImageIndex]}
              alt={listing.seoTitle || 'Listing preview'}
              fill
              className="object-cover transition-opacity duration-300"
              priority
            />
            {uniqueImages.length > 1 && (
              <>
                <button
                  onClick={prevImage}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white text-slate-800 rounded-full flex items-center justify-center shadow-lg transition-all z-10"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={nextImage}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white text-slate-800 rounded-full flex items-center justify-center shadow-lg transition-all z-10"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10 bg-black/40 px-3 py-2 rounded-full backdrop-blur-sm">
                  {uniqueImages.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`w-2 h-2 rounded-full transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/80'}`}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="text-slate-400 flex flex-col items-center">
            <Home className="w-12 h-12 mb-2 opacity-20" />
            <span className="font-medium text-sm">
              {isPreview ? 'Cover Image Required' : 'No cover image'}
            </span>
          </div>
        )}
      </div>

      {/* Sticky Stats Bar */}
      <div className="sticky top-0 sm:top-16 z-30 bg-white border-b border-slate-200 shadow-sm py-4">
        <div className="container mx-auto px-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-8">
            {listing.monthlyRent !== undefined && listing.monthlyRent !== null ? (
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
                {formatCurrency(listing.monthlyRent || 0)}
                <span className="text-base font-normal text-slate-500">/mo</span>
              </h2>
            ) : isPreview ? (
              <h2 className="text-2xl md:text-3xl font-bold text-slate-300/80 border-b-2 border-dashed border-slate-300/80">
                $---<span className="text-base font-normal">/mo</span>
              </h2>
            ) : null}

            <div className="hidden sm:flex items-center gap-4 text-slate-700 font-medium border-l border-slate-200 pl-4 md:pl-8">
              {listing.bedrooms !== null &&
              listing.bedrooms !== undefined &&
              String(listing.bedrooms) !== '' ? (
                <span>{Number(listing.bedrooms) === 0 ? 'Studio' : `${listing.bedrooms} bed`}</span>
              ) : isPreview ? (
                <span className="text-slate-400 border-b border-dashed border-slate-300">
                  - bed
                </span>
              ) : null}

              {listing.bathrooms !== null &&
              listing.bathrooms !== undefined &&
              String(listing.bathrooms) !== '' ? (
                <span>{listing.bathrooms} bath</span>
              ) : isPreview ? (
                <span className="text-slate-400 border-b border-dashed border-slate-300">
                  - bath
                </span>
              ) : null}

              {listing.sqft !== null &&
                listing.sqft !== undefined &&
                String(listing.sqft) !== '' && <span>{formatSqft(Number(listing.sqft) || 0)}</span>}
            </div>
            <div className="flex gap-2">
              {listing.aduType && <AduTypeBadge type={listing.aduType} />}
              {listing.permitStatus && <PermitBadge status={listing.permitStatus} showIcon />}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SaveButton listingId={listing.id} className="bg-white hidden sm:flex" />
            <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700">
              Contact Landlord
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Main Content (Left 65%) */}
          <div className="lg:col-span-2 space-y-12">
            <section>
              {listing.seoTitle ? (
                <h1 className="text-3xl font-bold text-slate-900 mb-4">{listing.seoTitle}</h1>
              ) : isPreview ? (
                <h1 className="text-3xl font-bold text-slate-300 border-b-2 border-dashed border-slate-300 inline-block mb-4">
                  Add a Catchy Headline
                </h1>
              ) : null}

              {hasAddress && (
                <div className="flex items-start gap-2 text-slate-600 mb-6">
                  <MapPin className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    {[listing.address, listing.city, listing.state, listing.zipCode]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
              )}

              {listing.description ? (
                <div className="prose prose-slate max-w-none text-slate-700">
                  <p className="text-lg leading-relaxed">{listing.description}</p>
                </div>
              ) : (
                isPreview && (
                  <div className="prose prose-slate max-w-none text-slate-400 italic">
                    <p className="text-lg leading-relaxed border border-dashed border-slate-200 p-4 rounded-lg bg-slate-50">
                      Provide a detailed description of your ADU to attract more renters and clarify
                      all property features.
                    </p>
                  </div>
                )
              )}
            </section>

            {(hasAmenities ||
              listing.proximityToEmployers ||
              hasLeasing ||
              (listing.utilitiesIncluded && listing.utilitiesIncluded.length > 0)) && (
              <hr className="border-slate-200" />
            )}

            {hasAmenities && (
              <>
                <section>
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Amenities & Features</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4">
                    {listing.privateEntrance !== null && listing.privateEntrance !== undefined ? (
                      <div className="flex items-center gap-3 text-slate-700">
                        <Key className="h-5 w-5 text-emerald-600 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-semibold">
                            {listing.privateEntrance ? 'Private Entrance' : 'Shared Entrance'}
                          </span>
                        </div>
                      </div>
                    ) : isPreview ? (
                      <div className="flex items-center gap-3 text-slate-400 opacity-60">
                        <Key className="h-5 w-5 shrink-0" />
                        <span className="border-b border-dashed border-slate-400">
                          Add Entrance Status
                        </span>
                      </div>
                    ) : null}

                    {listing.inUnitLaundry !== null && listing.inUnitLaundry !== undefined ? (
                      <div className="flex items-center gap-3 text-slate-700">
                        <Home className="h-5 w-5 text-emerald-600 shrink-0" />
                        <span className="capitalize">
                          {listing.inUnitLaundry === 'none'
                            ? 'No In-Unit Laundry'
                            : listing.inUnitLaundry.replace('_', ' ')}
                        </span>
                      </div>
                    ) : isPreview ? (
                      <div className="flex items-center gap-3 text-slate-400 opacity-60">
                        <Home className="h-5 w-5 shrink-0" />
                        <span className="border-b border-dashed border-slate-400">
                          Add Laundry Status
                        </span>
                      </div>
                    ) : null}

                    {listing.kitchenType !== null && listing.kitchenType !== undefined ? (
                      <div className="flex items-center gap-3 text-slate-700">
                        <ChefHat className="h-5 w-5 text-emerald-600 shrink-0" />
                        <span className="capitalize">
                          {listing.kitchenType === 'none'
                            ? 'No Kitchen'
                            : `${listing.kitchenType} Kitchen`}
                        </span>
                      </div>
                    ) : isPreview ? (
                      <div className="flex items-center gap-3 text-slate-400 opacity-60">
                        <ChefHat className="h-5 w-5 shrink-0" />
                        <span className="border-b border-dashed border-slate-400">
                          Add Kitchen Type
                        </span>
                      </div>
                    ) : null}

                    {(listing.parkingIncluded !== null && listing.parkingIncluded !== undefined) ||
                    listing.parkingDetails ? (
                      <div className="flex items-start gap-3 text-slate-700">
                        <Car className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="flex flex-col">
                          <span className="capitalize font-semibold">
                            {listing.parkingIncluded ? 'Parking Included' : 'No Dedicated Parking'}
                          </span>
                          {listing.parkingDetails && (
                            <span className="text-sm text-slate-500 leading-tight mt-0.5">
                              {listing.parkingDetails}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {listing.climateControl !== null && listing.climateControl !== undefined ? (
                      <div className="flex items-center gap-3 text-slate-700">
                        <Wind className="h-5 w-5 text-emerald-600 shrink-0" />
                        <span className="capitalize">
                          {listing.climateControl === 'none'
                            ? 'No Climate Control'
                            : listing.climateControl.replace('_', ' ')}
                        </span>
                      </div>
                    ) : null}

                    {listing.furnished !== null && listing.furnished !== undefined ? (
                      <div className="flex items-center gap-3 text-slate-700">
                        <Sofa className="h-5 w-5 text-emerald-600 shrink-0" />
                        <span className="capitalize">{listing.furnished} Furnished</span>
                      </div>
                    ) : null}

                    {listing.outdoorSpace && listing.outdoorSpace.toLowerCase() !== 'none' ? (
                      <div className="flex items-start gap-3 text-slate-700">
                        <Trees className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="flex flex-col">
                          <span className="font-semibold">Outdoor Space</span>
                          <span className="text-sm text-slate-500 leading-tight mt-0.5">
                            {listing.outdoorSpace}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <hr className="border-slate-200" />
              </>
            )}

            {listing.proximityToEmployers && (
              <>
                <section>
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Neighborhood & Location</h3>
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600 shrink-0">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">Proximity</h4>
                      <p className="text-slate-600 mt-1">{listing.proximityToEmployers}</p>
                    </div>
                  </div>
                </section>

                <hr className="border-slate-200" />
              </>
            )}

            {hasLeasing && (
              <>
                <section>
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Leasing & Requirements</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    {listing.leaseTerm ? (
                      <div className="flex gap-4">
                        <CalendarRange className="w-6 h-6 text-emerald-600 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-900">Lease Term</h4>
                          <p className="text-slate-600 capitalize">
                            {listing.leaseTerm.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    ) : isPreview ? (
                      <div className="flex gap-4 opacity-50">
                        <CalendarRange className="w-6 h-6 text-slate-400 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-500">Lease Term</h4>
                          <p className="text-slate-400 border-b border-dashed inline-block">
                            Missing Term Length
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {listing.utilitiesStrategy ? (
                      <div className="flex gap-4">
                        <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-900">Utilities Strategy</h4>
                          <p className="text-slate-600 capitalize">
                            {listing.utilitiesStrategy.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    ) : isPreview ? (
                      <div className="flex gap-4 opacity-50">
                        <ShieldCheck className="w-6 h-6 text-slate-400 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-500">Utilities Strategy</h4>
                          <p className="text-slate-400 border-b border-dashed inline-block">
                            Missing Strategy
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {listing.petPolicy && (
                      <div className="flex gap-4">
                        <Dog className="w-6 h-6 text-emerald-600 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-900">Pet Policy</h4>
                          <p className="text-slate-600">{listing.petPolicy}</p>
                        </div>
                      </div>
                    )}

                    {listing.contactPreference ? (
                      <div className="flex gap-4">
                        <Phone className="w-6 h-6 text-emerald-600 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-900">Contact Preference</h4>
                          <p className="text-slate-600 capitalize">{listing.contactPreference}</p>
                        </div>
                      </div>
                    ) : isPreview ? (
                      <div className="flex gap-4 opacity-50">
                        <Phone className="w-6 h-6 text-slate-400 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-slate-500">Contact Preference</h4>
                          <p className="text-slate-400 border-b border-dashed inline-block">
                            Missing Target Setup
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <hr className="border-slate-200" />
              </>
            )}

            {listing.utilitiesIncluded && listing.utilitiesIncluded.length > 0 && (
              <section>
                <h3 className="text-xl font-bold text-slate-900 mb-6">Utilities Included</h3>
                <div className="flex flex-wrap gap-3">
                  {listing.utilitiesIncluded.includes('water') && (
                    <Badge variant="secondary" className="px-4 py-2 bg-blue-50 text-blue-700">
                      <Droplet className="mr-2 h-4 w-4" /> Water
                    </Badge>
                  )}
                  {listing.utilitiesIncluded.includes('trash') && (
                    <Badge variant="secondary" className="px-4 py-2 bg-slate-100 text-slate-700">
                      <Trash2 className="mr-2 h-4 w-4" /> Trash
                    </Badge>
                  )}
                  {listing.utilitiesIncluded.includes('internet') && (
                    <Badge variant="secondary" className="px-4 py-2 bg-indigo-50 text-indigo-700">
                      <Wifi className="mr-2 h-4 w-4" /> Internet
                    </Badge>
                  )}
                  {/* Additional utilities can be rendered similarly */}
                </div>
              </section>
            )}
          </div>

          {/* Right Sidebar (35%) */}
          <div className="lg:col-span-1">
            <div className="sticky top-40 space-y-6">
              <div className="bg-white border text-center border-slate-200 rounded-xl p-6 shadow-sm">
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">
                  Available On
                </p>
                <p className="text-2xl font-bold text-slate-900">
                  {listing.availableDate ? formatDateString(listing.availableDate) : 'TBD'}
                </p>
                {listing.sellerName && (
                  <p className="text-sm text-slate-500 mt-4">Listed by {listing.sellerName}</p>
                )}
                <Button
                  className="w-full mt-6 bg-slate-900 hover:bg-slate-800 text-white"
                  size="lg"
                >
                  Request Tour
                </Button>
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6">
                <h4 className="font-semibold text-emerald-900 mb-2">Own a property nearby?</h4>
                <p className="text-emerald-700 text-sm mb-4">
                  See if your backyard qualifies for an ADU and how much it could earn.
                </p>
                <Button
                  variant="outline"
                  className="w-full bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                  asChild
                >
                  <a href="/map">Check ADU Feasibility &rarr;</a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
