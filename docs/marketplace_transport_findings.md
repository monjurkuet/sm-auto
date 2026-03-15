# Marketplace Transport Findings

Date: 2026-03-15

## Scope
- Seller profile route: `/marketplace/profile/61572591435930/`
- Listing detail route: `/marketplace/item/1244539514326495/`

## Findings

1. Seller inventory data was not observed on `/graphql/` or `/api/graphql/` responses during live refresh capture.
2. The seller inventory payload was present in the HTML document response inside `script[type="application/json"][data-sjs]` blocks handled by `ScheduledServerJS`.
3. Those HTML blocks contained `RelayPrefetchedStreamCache` payloads that match the expected Marketplace seller inventory shape, including:
   - `MarketplaceSellerProfileInventoryList_profile$stream$MarketplaceSellerProfileInventoryList_profile_marketplace_listing_sets`
   - `canonical_listing`
   - `listing_price`
   - `location.reverse_geocode`
   - `marketplace_listing_seller`
4. Listing detail showed the same transport pattern in this session:
   - rich listing payload embedded in the HTML document
   - only trivial `/api/graphql/` seen-state responses observed live
5. `ajax/bulk-route-definitions` responses were present, but they contained route metadata and entrypoint/query preload descriptors, not the full listing inventory payload itself.

## Seller Profile Evidence

Observed in the HTML document response:

```json
{
  "data": {
    "profile": {
      "__typename": "User",
      "marketplace_listing_sets": {
        "edges": [
          {
            "node": {
              "canonical_listing": {
                "__typename": "GroupCommerceProductItem",
                "id": "1484770273045671",
                "listing_price": {
                  "formatted_amount": "BDT4,999",
                  "amount": "4999.00"
                },
                "location": {
                  "reverse_geocode": {
                    "city_page": {
                      "display_name": "Dhaka, Bangladesh"
                    }
                  }
                },
                "marketplace_listing_title": "Lenovo Centrino Duo fresh Laptop",
                "marketplace_listing_seller": {
                  "name": "DI PU",
                  "id": "61572591435930"
                }
              }
            }
          }
        ]
      }
    }
  }
}
```

Observed in later streamed HTML blocks:

```json
{
  "label": "MarketplaceSellerProfileInventoryList_profile$stream$MarketplaceSellerProfileInventoryList_profile_marketplace_listing_sets",
  "path": ["profile", "marketplace_listing_sets", "edges", 2],
  "data": {
    "node": {
      "canonical_listing": {
        "__typename": "GroupCommerceProductItem",
        "id": "950298004113842",
        "listing_price": {
          "formatted_amount": "BDT4,200",
          "amount": "4200.00"
        },
        "location": {
          "reverse_geocode": {
            "city_page": {
              "display_name": "Dhaka, Bangladesh"
            }
          }
        },
        "marketplace_listing_title": "Samsung Netbook"
      }
    }
  }
}
```

## Listing Detail Evidence

Observed in the HTML document response:

```json
{
  "queryName": "MarketplacePDPContainerQuery",
  "variables": {
    "targetId": "1244539514326495"
  }
}
```

Observed in the embedded listing payload:

```json
{
  "__typename": "GroupCommerceProductItem",
  "id": "1244539514326495",
  "listing_price": {
    "formatted_amount_zeros_stripped": "BDT0",
    "amount": "0.00",
    "currency": "BDT"
  },
  "delivery_types": ["IN_PERSON"],
  "base_marketplace_listing_title": "Urgent Sell 13th Gen core i3 Hp Laptop 8GB RAM 512GB SSD New conditions",
  "marketplace_listing_title": "Urgent Sell 13th Gen core i3 Hp Laptop 8GB RAM 512GB SSD New conditions"
}
```

## Implication For The Scraper

Current scraper behavior misses these payloads because the capture layer only records responses whose URL contains `/graphql/` or `/api/graphql/`.

Relevant code:
- `sm-auto/src/capture/graphql_capture.ts`
- `sm-auto/src/extractors/marketplace_listing_extractor.ts`
- `sm-auto/src/extractors/marketplace_seller_extractor.ts`

## Recommended Direction

1. Keep network GraphQL capture, but do not assume Marketplace data arrives there.
2. Add a second capture path for embedded `ScheduledServerJS` / `RelayPrefetchedStreamCache` payloads from the HTML document.
3. Parse Marketplace seller and listing data from those embedded payloads before falling back to DOM extraction.
