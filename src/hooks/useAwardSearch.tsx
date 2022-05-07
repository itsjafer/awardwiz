import React from "react"
import * as ReactQuery from "react-query"
import { NodeIndexOutlined } from "@ant-design/icons"
import axios from "axios"
import useDeepCompareEffect from "use-deep-compare-effect"
import moment from "moment"
import { DebugTreeNode, genNewDebugTreeNode, useDebugTree } from "../components/DebugTree"
import type { LambdaRequest, LambdaResponse, SearchQuery } from "../types/types"
//import type { SearchQuery } from "../types/types"
import { FR24SearchResult } from "../types/fr24"
import { FlightWithFares, ScraperQuery, ScraperResults } from "../types/scrapers"
import PhAirplaneTilt from "~icons/ph/airplane-tilt"
import CarbonPaintBrush from "~icons/carbon/paint-brush"
import scrapers from "../scrapers/scrapers.json"
import Text from "antd/lib/typography/Text"
import * as ts from "typescript"
const scraperCode = import.meta.glob("../scrapers/*.ts", { as: "raw" })

type QueryPairing = {origin: string, destination: string, departureDate: string}
type ServingCarrier = { origin: string, destination: string, airlineCode?: string, airlineName?: string }

export const useAwardSearch = (searchQuery: SearchQuery) => {
  const debugTree = useDebugTree()

  // Take all origins and destinations and create a list of all possible pairs
  const [queryPairings, setQueryPairings] = React.useState<QueryPairing[]>([])  // 1-to-1 mappings of origin/destination (ex. SFO-HNL, OAK-HNL, SJC-HNL)
  React.useEffect(() => {
    const pairings = searchQuery.origins.flatMap((origin) => searchQuery.destinations.map((destination) => ({ origin, destination, departureDate: searchQuery.departureDate }) as QueryPairing))
    const debugChildren = pairings.map((pairing) => genNewDebugTreeNode({
      key: `${pairing.origin}${pairing.destination}`, textA: `${pairing.origin} → ${pairing.destination}`, origIcon: <NodeIndexOutlined />
    }))

    debugTree({ type: "update", payload: { key: "root", updateData: { textA: `Search for ${searchQuery.origins.join(",")} → ${searchQuery.destinations.join(",")} on ${searchQuery.departureDate}`, children: debugChildren } } })
    setQueryPairings(pairings)
  }, [searchQuery, debugTree])

  // Return the list of carriers that fly the given pairings
  const servingCarriersQueries = ReactQuery.useQueries({ queries:
    queryPairings.map((pairing) => {
      return {
        queryKey: ["servingCarriers", pairing.origin, pairing.destination],
        queryFn: async () => {
          const startTime = Date.now()
          debugTree({ type: "update", payload: { key: `${pairing.origin}${pairing.destination}`, updateData: { textB: "Requesting serving carriers...", isLoading: true } } })

          const postData = {
            code: "module.exports=async({page:a,context:b})=>{const{url:c}=b;await a.goto(c);const d=await a.content();const innerText = await a.evaluate(() => document.body.innerText);return{data:JSON.parse(innerText),type:\"application/json\"}};",
            context: { url: `https://api.flightradar24.com/common/v1/search.json?query=default&origin=${pairing.origin}&destination=${pairing.destination}` }
          }
          const { data } = await axios.post<FR24SearchResult>("http://localhost:4000/function", postData /*, { signal }*/)

          if (data.errors)
            throw new Error(`${data.errors.message} -- ${JSON.stringify(data.errors.errors)}`)
          if (!data.result.response.flight.data)
            return []

          const carriers = data.result.response.flight.data
            .map((item) => ({ origin: item.airport.origin.code.iata, destination: item.airport.destination.code.iata, airlineCode: item.airline?.code.iata, airlineName: item.airline?.name } as ServingCarrier))
            .filter((item, index, self) => self.findIndex((t) => t.origin === item.origin && t.destination === item.destination && t.airlineCode === item.airlineCode) === index)   // remove duplicates
            .filter((item) => item.airlineCode && item.airlineName)   // remove flights without sufficient data (usually private flights)
            .filter((item) => !["1I", "FX", "KH", "5X", "8C"].includes(item.airlineCode!))

          debugTree({ type: "update", payload: { key: `${pairing.origin}${pairing.destination}`, updateData: { textB: `Success after ${Date.now() - startTime}ms`, isLoading: false } } })
          return carriers
        },
        onError: (err: Error) => debugTree({ type: "update", payload: { key: `${pairing.origin}${pairing.destination}`, updateData: { textB: `Error: ${err.message}`, isLoading: false } } })
      } as ReactQuery.UseQueryOptions<ServingCarrier[]>
    })
  })

  const servingCarriers = servingCarriersQueries
    .filter((item) => item.data)
    .map((item) => item.data)
    .flat() as ServingCarrier[]

  // Figure out which scrapers are compatible for the given pairings
  const [scrapeQueries, setScrapeQueries] = React.useState<ScraperQuery[]>([])
  useDeepCompareEffect(() => {
    const origDestCarriers = servingCarriers.reduce((result, servingCarrier: ServingCarrier) => {
      const scrapedBy = scrapers.filter((scraper) => scraper.supportedAirlines.includes(servingCarrier.airlineCode!)).map((scraper) => scraper.name)
      const debugChild = genNewDebugTreeNode({ key: `${servingCarrier.origin}${servingCarrier.destination}${servingCarrier.airlineCode}`, textA: `${servingCarrier.airlineName}`, textB: scrapedBy.length > 0 ? <Text code>{scrapedBy.join(", ")}</Text> : "", origIcon: <PhAirplaneTilt /> })
      const origDest = `${servingCarrier.origin}${servingCarrier.destination}`

      result[origDest] ||= { debugChildren: [], scrapers: [], origin: servingCarrier.origin, destination: servingCarrier.destination }
      result[origDest].debugChildren.push(debugChild)
      result[origDest].scrapers.push(...scrapedBy)
      return result
    }, {} as { [key: string]: { debugChildren: DebugTreeNode[], scrapers: string[], origin: string, destination: string } })

    // Loop over flight pairings and create queries to run scraper (and also add to debug tree)
    const newScrapeQueries = Object.entries(origDestCarriers).flatMap(([origDestKey, carrierItem]): ScraperQuery[] => {
      const uniqueScrapers = [...new Set(carrierItem.scrapers)]
      const uniqueScraperNodes = uniqueScrapers.map((scraper) => genNewDebugTreeNode({ key: `${origDestKey}${scraper}`, textA: <>Scraper: <Text code>{scraper}</Text></>, origIcon: <CarbonPaintBrush /> }))
      debugTree({ type: "update", payload: { key: origDestKey, updateData: { children: carrierItem.debugChildren.concat(uniqueScraperNodes) } } })

      return uniqueScrapers.map((scraper) => ({ scraper, origin: carrierItem.origin, destination: carrierItem.destination, departureDate: searchQuery.departureDate }))
    })

    setScrapeQueries(newScrapeQueries)
  }, [debugTree, servingCarriers])       // will need searchQuery.departureDate in the future

  // Run the scrapers
  const searchQueries = ReactQuery.useQueries({ queries:
    scrapeQueries.map((scraperQuery) => {
      return {
        queryKey: ["awardAvailability", scraperQuery],
        staleTime: 1000 * 60 * 5,
        cacheTime: 1000 * 60 * 15,
        retry: 1,
        queryFn: async ({ signal }) => {
          const startTime = Date.now()
          debugTree({ type: "update", payload: { key: `${scraperQuery.origin}${scraperQuery.destination}${scraperQuery.scraper}`, updateData: { textB: "Searching...", isLoading: true } } })

          const path = Object.keys(scraperCode).find((key) => key.indexOf(`${scraperQuery.scraper}.ts`) > -1)
          if (!path)
            throw new Error(`Could not find scraper ${scraperQuery.scraper}`)
          const code = scraperCode[path] as unknown as string

          const transpileOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES5,
            //lib: ["esnext"],
            esModuleInterop: false,
            allowSyntheticDefaultImports: true,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            resolveJsonModule: true,
            isolatedModules: true,
            types: []
          }

          const out = ts.transpile(code, transpileOptions)

          // const postData = { code, context: scraperQuery }
          // const scraperResults = (await axios.post<ScraperResults>("http://localhost:4000/function", postData, { signal })).data

          const postData: LambdaRequest = { code: out, context: scraperQuery, browser: "chromium", browserArgs: [] }
          const lambdaResponse = (await axios.post<LambdaResponse>("http://localhost:9001/2015-03-31/functions/function/invocations", postData, { signal })).data
          debugger
          debugTree({ type: "update", payload: { key: `${scraperQuery.origin}${scraperQuery.destination}${scraperQuery.scraper}`, updateData: { textB: `Success after ${Date.now() - startTime}ms`, isLoading: false } } })
          return lambdaResponse.scraperResults.flightsWithFares
        },
        onError: (err: Error) => debugTree({ type: "update", payload: { key: `${scraperQuery.origin}${scraperQuery.destination}${scraperQuery.scraper}`, updateData: { textB: `Error: ${err.message}`, isLoading: false } } })
      } as ReactQuery.UseQueryOptions<FlightWithFares[]>
    })
  })

  const scraperResults = searchQueries
    .filter((item) => item.data)
    .map((item) => item.data)
    .flat() as FlightWithFares[]

  const isLoading = servingCarriersQueries.some((query) => query.isLoading) || searchQueries.some((query) => query.isLoading)
  const error = servingCarriersQueries.find((query) => query.error) || searchQueries.find((query) => query.error)
  const dataNoOlderThan = searchQueries.reduce((acc, query) => {
    return moment(query.dataUpdatedAt) < acc ? moment(query.dataUpdatedAt) : acc
  }, moment())

  return { searchResults: scraperResults, isLoading, error: error && error?.error as Error, dataNoOlderThan }
}
