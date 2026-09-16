/**
 * ECharts 按需引入（tree-shaking）。
 * 只注册本项目真正用到的图表与组件，避免把整个 echarts 打进产物。
 * 新增图表类型时，记得在这里补注册对应的 chart / component。
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent, // inside + slider 两种 dataZoom
  GraphicComponent, // 图内文字提示（序列整列不可用时）
  GridComponent,
  LegendComponent,
  MarkLineComponent, // 持仓看板：发散条形图在 0 处的参考线
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart, // 持仓看板：分组结构对比、个股盈亏排行
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  GraphicComponent,
  MarkLineComponent,
  CanvasRenderer,
])

export default echarts
export const init = echarts.init
