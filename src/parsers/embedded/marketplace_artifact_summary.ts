import type { GraphQLFragment } from '../../types/contracts';
import type { RouteDefinitionCaptureRecord } from '../../capture/route_definition_capture';
import type { MarketplaceSellerDomProfile } from '../dom/marketplace_dom_parser';
import type { MarketplaceListing } from '../../types/contracts';
import { countBy } from '../../core/utils';
import {
  parseMarketplaceListingFragments,
  parseMarketplaceSearchFragments,
  parseMarketplaceSellerInventoryFragments
} from '../graphql/marketplace_parser';
import { deepVisit, getString } from '../graphql/shared_graphql_utils';

export function summarizeMarketplaceGraphqlFragments(fragments: GraphQLFragment[]): Record<string, unknown> {
  const friendlyNames = countBy(
    fragments.map((fragment) => fragment.request.friendlyName ?? '(unknown)').filter(Boolean)
  );
  const docIds = countBy(fragments.map((fragment) => fragment.request.docId ?? '(none)').filter(Boolean));
  const labels: string[] = [];
  const paths: string[] = [];
  const listingIds = new Set<string>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        if (typeof record.label === 'string') {
          labels.push(record.label);
        }
        if (Array.isArray(record.path)) {
          paths.push(record.path.slice(0, 4).join('.'));
        }
      }

      deepVisit(payload, (node) => {
        if (node.__typename === 'GroupCommerceProductItem') {
          const id = getString(node.id);
          if (id) {
            listingIds.add(id);
          }
        }
      });
    }
  }

  return {
    responseCount: fragments.length,
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    friendlyNames: friendlyNames.slice(0, 20),
    docIds: docIds.slice(0, 20),
    labels: countBy(labels).slice(0, 20),
    paths: countBy(paths).slice(0, 20),
    marketplaceListingCount: listingIds.size,
    sampleListingIds: [...listingIds].slice(0, 20)
  };
}

export function summarizeEmbeddedMarketplaceSearch(fragments: GraphQLFragment[]): Record<string, unknown> {
  const listings = parseMarketplaceSearchFragments(fragments);
  return {
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    listingCount: listings.length,
    sampleListings: listings.slice(0, 10).map((listing) => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      seller: listing.seller,
      location: listing.location
    }))
  };
}

export function summarizeEmbeddedMarketplaceListing(
  fragments: GraphQLFragment[],
  listingId: string
): Record<string, unknown> {
  const listing = parseMarketplaceListingFragments(fragments, listingId);
  return {
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    listing: listing
      ? {
          id: listing.id,
          title: listing.title,
          price: listing.price,
          seller: listing.seller,
          location: listing.location,
          deliveryOptions: listing.deliveryOptions,
          imageCount: listing.images.length
        }
      : null
  };
}

export function summarizeEmbeddedMarketplaceSeller(fragments: GraphQLFragment[]): Record<string, unknown> {
  const listings = parseMarketplaceSellerInventoryFragments(fragments);
  return {
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    listingCount: listings.length,
    sampleListings: listings.slice(0, 10).map((listing) => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      seller: listing.seller,
      location: listing.location
    }))
  };
}

export function summarizeDomMarketplaceListing(listing: MarketplaceListing): Record<string, unknown> {
  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    seller: listing.seller,
    location: listing.location,
    imageCount: listing.images.length,
    availability: listing.availability,
    deliveryOptions: listing.deliveryOptions
  };
}

export function summarizeDomMarketplaceSeller(profile: MarketplaceSellerDomProfile): Record<string, unknown> {
  return {
    seller: profile.seller,
    listingCount: profile.listings.length,
    sampleListings: profile.listings.slice(0, 10).map((listing) => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      location: listing.location
    }))
  };
}

export function summarizeRouteDefinitions(records: RouteDefinitionCaptureRecord[]): Record<string, unknown> {
  const routes = records.flatMap((record) => record.routes);
  const routesWithLocation = routes.filter((route) => route.location);

  return {
    responseCount: records.length,
    routeCount: routes.length,
    routesWithLocationCount: routesWithLocation.length,
    sampleRoutes: routesWithLocation.slice(0, 20).map((route) => ({
      routeUrl: route.routeUrl,
      canonicalRouteName: route.canonicalRouteName,
      location: route.location
    }))
  };
}
