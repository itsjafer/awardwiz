import * as React from "react"
import moment from "moment"
import { LeftOutlined, RightOutlined, SearchOutlined, SwapOutlined } from "@ant-design/icons"
import { Alert, Button, DatePicker, Form } from "antd"
import { SearchResults } from "./SearchResults"
import { SelectAirport } from "./SelectAirport"
import { useAwardSearch } from "../hooks/useAwardSearch"
import { DebugTree } from "./DebugTree"
import { useAwardSearchDebugTree } from "../hooks/useAwardSearchDebugTree"
import { SearchQuery } from "../types/scrapers"

export const FlightSearch = () => {
  console.log("render")

  const defaultSearchQuery = { origins: ["SFO"], destinations: ["HNL", "LIH"], departureDate: moment().add("1", "day").format("YYYY-MM-DD") }
  const [searchQuery, setSearchQuery] = React.useState<SearchQuery>(() => JSON.parse(localStorage.getItem("searchQuery") || JSON.stringify(defaultSearchQuery)))
  const { searchResults, isLoading, error, pairings, servingCarriers, scrapersForRoutes } = useAwardSearch(searchQuery)
  const { debugTree, debugTreeRootKey } = useAwardSearchDebugTree({ searchQuery, pairings, servingCarriers, scrapersForRoutes, isLoading })

  React.useEffect(() => {
    localStorage.setItem("searchQuery", JSON.stringify(searchQuery))
  }, [searchQuery])

  const initialValuesWithMoment = { ...searchQuery, departureDate: moment(searchQuery.departureDate) }
  const [form] = Form.useForm()
  return (
    <>
      <Form form={form} initialValues={initialValuesWithMoment} layout="inline" onFinish={(values) => { setSearchQuery({ ...values, departureDate: moment(values.departureDate).format("YYYY-MM-DD") }) }}>
        <Form.Item name="origins" rules={[{ type: "array", min: 1 }]} style={{ width: 200, marginRight: 5, marginBottom: 0 }}><SelectAirport placeholder="Origins" /></Form.Item>
        <Button icon={<SwapOutlined />} size="small" style={{ marginRight: 5, marginTop: 5 }} onClick={() => { form.setFieldsValue({ origins: form.getFieldValue("destinations"), destinations: form.getFieldValue("origins") }) }} />
        <Form.Item name="destinations" rules={[{ type: "array", min: 1 }]} style={{ width: 200, marginBottom: 0 }}><SelectAirport placeholder="Destinations" /></Form.Item>
        <Form.Item name="departureDate" style={{ marginRight: 5 }}><DatePicker disabledDate={(current) => current.isBefore(moment().subtract(1, "day"))} allowClear={false} /></Form.Item>
        <Button icon={<LeftOutlined />} size="small" style={{ marginRight: 5, marginTop: 5 }} onClick={() => { form.setFieldsValue({ departureDate: moment(form.getFieldValue("departureDate")).subtract("1", "day") }) }} />
        <Button icon={<RightOutlined />} size="small" style={{ marginRight: 5, marginTop: 5 }} onClick={() => { form.setFieldsValue({ departureDate: moment(form.getFieldValue("departureDate")).add("1", "day") }) }} />
        <Form.Item wrapperCol={{ offset: 2, span: 3 }} style={{ marginLeft: 10 }}><Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={isLoading}>Search</Button></Form.Item>
      </Form>

      {error && <Alert message={error.message} type="error" />}
      <SearchResults results={searchResults} isLoading={false} />
      <DebugTree debugTree={debugTree} rootKey={debugTreeRootKey} />
    </>
  )
}
