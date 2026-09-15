/**
 * ECharts 按需引入（tree-shaking）。
 * 只注册本项目真正用到的图表与组件，避免把整个 echarts 打进产物。
 * 新增图表类型时，记得在这里补注册对应的 chart / component。
 */
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent, // inside + slider 两种 dataZoom
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
])

export default echarts
export const init = echarts.init
