# Blue Current：三维群体生态模拟实验报告

项目：Blue Current — A Real-time 3D Predator–Prey Flocking Simulation  
版本：0.1.0（2026-11-15 提交版）  
完成日期：2026-11-15  
代码目录：`BlueCurrent/`  
原始数据：`benchmarks/`  
验证记录：`VALIDATION_REPORT.md`

## 摘要

Blue Current 是一个实时三维捕食者—猎物群体模拟程序。500 条初始猎物鱼不共享完整路径，而是根据局部邻居的速度和位置执行分离、对齐与聚合；一条捕食者通过巡逻、检测、预测追逐、攻击和搜索状态机改变群体行为。程序用三维均匀网格减少邻居候选，用 SoA 连续数组、双缓冲和固定时间步保证更新一致性，并通过 Three.js 实例化渲染将模拟状态显示为可交互的水下场景。三项实测实验分别比较两种邻居搜索、消融三种 Boids 规则，以及比较四种捕食条件。结果显示：网格在 2000 条鱼时相对暴力搜索有 1.26× 的平均步耗时收益，但 100 条时因固定开销而慢于暴力搜索；三规则完整配置形成单一主群体且方向一致性最高；捕食者只有在猎物逃逸启用时才导致显著的受惊响应和局部群体分裂，20 s 恢复窗口后仍保留了额外连通群体。2026-11 的提交版在不改变默认场景与固定步语义的前提下加入本地 GLB 资产、小丑鱼/海葵与沙尘、鱼体姿态和群体结构项，并在 Windows 11 / Intel Iris Xe 硬件上完成 1280×720 标准档的实时运行验收；5.1–5.3 为 2026-11-08 初版沙箱受控实验。

## 1. 选题与目标

### 1.1 问题

项目研究的是一个典型的自组织动画问题：如何在不预设整群轨迹的情况下，让大量个体仅根据局部信息产生协调运动，并让外部威胁改变这种协调。输入包括鱼数、初始种子、Boids 权重与半径、速度限制、捕食者与障碍参数；输出包括每一固定步的全部位置、速度、捕食者状态，以及渲染帧、实时统计和可离线测量的群体指标。

选择 Boids 作为研究对象，是因为它把“复杂整体运动”压缩为少量局部规则：个体只感知有限半径内的邻居，却能产生没有中心控制者的群体结构，这与课程关心的自组织动画和逐帧可控性直接对应。只有三条规则时，群体在无扰动条件下会持续群游，结构变化难以观察，因此项目再引入捕食者：它既是可交互的外部威胁，也是画面中最容易辨识的因果来源，用来检验群体在追逐、分裂和重组过程中的表现。

### 1.2 场景与功能目标

场景限定为 40×20×40 的水柱，海底和人造礁石位于下方，鱼群和捕食者活动于其中。程序需要呈现四个阶段：自然群游、绕行障碍、捕食者追逐与逃逸、威胁离开后的群体重组。最终功能包括三维 Boids、两种邻居搜索、捕食者状态机、真实捕获、猎物逃逸、球体障碍避让、软边界、实例化渲染、实时参数控制和性能统计。

从课程目标看，项目同时服务三类目标，后文的实现与实验也按这三类组织：

- 动画目标：个体仅依赖局部信息产生自然群游、绕行和逃逸，并让鱼体姿态随转弯与威胁变化；
- 算法目标：在保持行为公式不变的前提下降低邻居搜索成本，并用受控实验量化收益与适用规模；
- 系统功能目标：提供实时参数控制、可核对的运行统计和可复现的实验入口，使画面中的指标来自真实模拟。

“鱼群数量变化”“捕获数”“当前状态”等界面值必须来自正在运行的模拟；无法从暴力搜索获得的网格占用数显示 `N/A`，不以估计值填充。

### 1.3 实现边界

当前版本只包含一种猎物和一条捕食者，不包含多物种协同、刚体接触求解、复杂三角网格碰撞、WebGPU Compute 或运行时从网络加载外部模型。提交版使用的 GLB 鱼、礁石与珊瑚均为随包本地资产（见 4.2），首次运行不需要联网。鱼体间距由分离力维持，而非物理碰撞约束。

## 2. 算法原理与实际实现

### 2.1 Boids 群体行为

对鱼 \(i\)，位置为 \(p_i\)、速度为 \(v_i\)。三项行为使用不同感知半径，因此分别定义邻居集合 \(N_i^{sep}\)、\(N_i^{ali}\)、\(N_i^{coh}\)；每个集合只包含对应半径内的存活鱼，启用视野裁剪时还须通过视野检查。三项行为分别为：

\[
S_i=-\sum_{j\in N_i^{sep}}\frac{p_j-p_i}{\|p_j-p_i\|^2+\epsilon}
\]

\[
A_i=\frac{1}{|N_i^{ali}|}\sum_{j\in N_i^{ali}}(v_j-v_i),\qquad
C_i=\frac{1}{|N_i^{coh}|}\sum_{j\in N_i^{coh}}(p_j-p_i)
\]

\[
a_i=w_sS_i+w_aA_i+w_cC_i+w_pE_i+O_i+B_i
\]

其中 \(E_i\) 为逃逸，\(O_i\) 为避障，\(B_i\) 为边界力；任一邻居集合为空时对应项取 0。程序不是简单把三项相加后立即改变位置，而是先限制加速度长度，再以 \(\Delta t=1/60\) 更新速度，随后限制速度并更新位置。默认参数为分离半径 1.4、对齐半径 4、聚合半径 6，权重分别为 2.4、0.9、0.32，最大速度 6，最大加速度 14。

三个半径分别筛选邻居，避免把远距离对齐或近距离聚合混为同一范围。默认视野为 360°，但程序保留 120°–360° 可调视野；视野裁剪只作用于对齐与聚合，分离仍响应所有方向。程序实现中，三项行为共用一次候选遍历；选择网格或暴力搜索只改变候选从哪里来，不改变行为累加公式。

### 2.2 三维 Uniform Grid

若所有鱼两两比较，邻居搜索为 \(O(N^2)\)。程序将水域划分为边长 \(h=R_{\max}\) 的均匀网格，其中 \(R_{\max}\) 是三项感知半径的最大值。格坐标：

\[
c_x=\left\lfloor\frac{x-x_{\min}}{h}\right\rfloor
\]

另外两维同理。每步以两个数组建立链表：`head[cell]` 指向该格第一条鱼，`next[fish]` 指向同格下一条鱼。重建时只清空表头并遍历所有存活鱼；查询时检查自身所在格及相邻 26 格，随后用平方距离精确筛选。因为 \(h\ge R_{\max}\)，查询球不会跨越这 27 格之外。

这种结构在密度很高时仍可能退化：同一格可能容纳大量鱼，而且行为计算与积分成本不会随网格消失。性能实验因此保留暴力搜索作为对照，而不是根据理论复杂度断言网格更快。

### 2.3 捕食者状态机

捕食者有四个主动状态：`patrol`、`pursuit`、`attack`、`search`。巡逻状态沿随机/采样目标游动；检测到半径内最近的鱼后进入追逐；距离小于攻击半径时进入攻击；目标死亡、超时或丢失后进入搜索，搜索超过 2.4 s 回到巡逻。目标选择有 0.35 s 重选间隔，捕获后有 1.6 s 检测冷却，避免逐帧切换目标。

追逐目标不是鱼当前位置，而是：

\[
p_{\text{target}}=p_{\text{prey}}+\kappa\,t\,v_{\text{prey}},\qquad
t=\operatorname{clamp}\left(\frac{d}{|v_{\text{predator}}|},0,1.1\right),\quad \kappa=0.8
\]

其中 \(d\) 为当前距离，\(\kappa=0.8\) 是抑制过冲的提前量系数，公式已与实际实现一致。捕食者拥有独立的速度上限、转向加速度、障碍避让和安全约束。只有攻击状态且实际距离小于 0.95 时才调用 `FlockData.remove()`，因此捕获数、存活数和界面提示对应同一次真实事件。

### 2.4 猎物逃逸、障碍和边界

当捕食者距离小于逃逸半径 \(R_e=8\) 时，逃逸项为：

\[
E_i=
\begin{cases}
\left(1-\dfrac{d_i}{R_e}\right)^{2}\operatorname{normalize}(p_i-p_{\text{predator}}), & d_i<R_e,\\[2pt]
0, & d_i\ge R_e,
\end{cases}
\]

其中 \(d_i=\|p_i-p_{\text{predator}}\|\)。也就是说，逃逸项本身随距离平方衰减，并且在逃逸半径外为 0；加速度公式中的 \(w_p\) 只承担权重，不需要再乘额外的衰减因子。受惊值同时用于鱼体颜色。受惊时最高速度和最高加速度允许临时提高 25%，威胁解除后随下一固定步恢复。因此不存在永久高权重逃逸。

礁石使用五个球体，与渲染位置一致。避让不仅检查当前位置，还检查 \(p+v\cdot0.55\) 的短时预测位置；强度随进入安全边界的深度增加，并加入沿球面切线方向的分量，让鱼绕过而不是正对反弹。积分后仍做一次安全投影，将意外进入球体的鱼推到半径加 0.28 的表面，并消除向内速度。

边界分两级：距边界 3 单位内施加二次软力，最后一个位置约束保证不越界；越过时速度反射为原值的 0.35 倍。软力负责连续动画，位置约束只负责数值安全。

### 2.5 固定时间步与双缓冲

模拟不使用可变帧差积分。主循环将真实帧差加入累加器，每次取 1/60 s 执行固定步，单帧最多补算 8 步，并丢弃超过 150 ms 的输入跨度，防止卡顿后无限追赶。渲染使用 `accumulator / fixedDelta` 在上一位置和当前位置间插值。

每步开始时复制当前位置到 `previousPositions`，所有鱼从当前 `positions/velocities` 读取，将结果写入 `nextPositions/nextVelocities`，全部完成后才交换数组。这样同一条鱼读取不到其他鱼在本步中刚写入的新状态，消除了个体编号造成的顺序偏差。鱼的位置、速度、受惊值、相位和倾斜角均使用连续 `Float32Array`；高频循环避免为每条鱼临时创建向量对象。

## 3. 程序实现

### 3.1 模块结构

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 模拟内核 | `src/simulation/SimulationWorld.ts` | 固定步编排、重置、统计、组群连通分量 |
| 模拟内核 | `src/simulation/BoidSystem.ts` | 邻居规则、逃逸、力限制、速度/位置积分、倾斜 |
| 模拟内核 | `src/simulation/PredatorSystem.ts` | 捕食者状态机、预测追逐、捕获 |
| 模拟内核 | `src/simulation/ObstacleSystem.ts` | 预测球体避让与安全投影 |
| 数据 | `src/simulation/FlockData.ts` | SoA 数组、双缓冲交换、存活标记 |
| 空间查询 | `src/spatial/UniformGrid3D.ts` | 27 格链表查询、占用单元调试 |
| 空间查询 | `src/spatial/BruteForceSearch.ts` | 全量候选基线 |
| 渲染 | `src/rendering/SceneManager.ts` | 相机、renderer、场景更新 |
| 渲染 | `src/rendering/FishRenderer.ts` | `InstancedMesh`、朝向、倾斜、颜色、尾鳍 shader |
| 渲染 | `src/rendering/Environment.ts` | 鱼几何、海床、礁石、珊瑚、雾中远景、粒子 |
| 渲染 | `src/rendering/PredatorRenderer.ts` | 暖色捕食者、体鳍、尾摆 |
| UI | `src/ui/ControlPanel.ts` | 参数、暂停、搜索切换、真实模式同步 |
| UI | `src/ui/StatisticsPanel.ts` | 实时指标、状态文案、捕获提示 |
| 入口 | `src/main.ts` | 固定步调度、帧率、调试接口 |

### 3.2 主要数据结构与数据流

`FlockData` 分配容量 2000：

```text
positions, velocities, nextPositions, nextVelocities,
previousPositions, banks, nextBanks, previousBanks,
alive, fear, phases, variants
```

固定步数据流：

```text
目标与参数
  → 重建 neighbor search
  → 每条存活鱼：候选邻居 → 三项 Boids + 逃逸 + 避障 + 边界
  → 加速度/速度限制 → 写 next 数组
  → 交换当前与 next
  → 捕食者状态机读取新鱼群 → 真实捕获
  → 同步 metrics
渲染帧
  → 上一位置/当前位置插值
  → 实例矩阵、转弯倾斜、受惊颜色、尾鳍 shader
```

`SimulationWorld` 是 UI 与模拟之间的边界。UI 不直接改 GPU 缓冲，也不直接写鱼数组；参数更新通过配置对象，捕获数、方向一致性和群体数通过只读 metrics 提供。统计中的回旋半径：

\[
R_g=\sqrt{\frac1N\sum_i\|p_i-\bar p\|^2}
\]

方向一致性为存活鱼单位速度合向量长度除以存活数量。连通群体由 3.2 单位连接阈值建立并查集，只统计至少 5 条鱼的连通分量，每 30 个固定步更新一次。空间网格的占用单元数来自真实索引；暴力搜索时该项显示 `N/A`。

第 5 章的群体指标除回旋半径与方向一致性外，还包括威胁期与恢复期的连通分量统计；这些指标的定义与统计口径见表 1。

表 1：群体指标定义与统计口径（采样参数见 5.3 节）

| 指标 | 定义 | 统计口径 |
| --- | --- | --- |
| 连通群体数（群体数） | 以 3.2 单位为连接阈值，对存活鱼按距离建立并查集，统计成员数不少于 5 的连通分量个数；每 30 个固定步更新一次 | 对 3 个随机种子运行先各自取窗口平均，再取均值 |
| 严格最大群体数 | 威胁期内按 15 个固定步采样，取 2.0 单位严格连接阈值下连通分量数的最大值 | 先对单次运行取时间最大值，再对 3 个种子取均值 |
| 恢复期宽群体数 | 恢复窗口后半段（威胁解除后再过 600 步起的 40 个采样）在 3.2 单位阈值下的连通分量数 | 先对单次运行按采样取时间平均，再对 3 个种子取均值 |
| 受惊鱼均值 | 威胁期 40 个采样中“位于捕食者逃逸半径内的鱼数” | 先对单次运行取时间平均，再对 3 个种子取均值 |
| 捕获/运行 | 一次运行结束时 `world.metrics.captures` 记录的捕获数 | 对 3 次运行取均值，因此允许出现小数 |
| 回旋半径 \(R_g\) | 按上式计算的群体空间尺度 | 在采样窗口内取时间平均，再对 3 个种子给出均值与样本标准差 |

因此第 5 章表格中的部分群体数不是整数：它们不是单帧瞬间值，而是先对时间窗口、再对随机种子求平均的结果；只有 3 个种子结果相同时才会恰好为整数（例如严格最大群体数 4 来自三次运行的 3、6、3）。捕获/运行同理，0.667 表示三次运行共捕获 2 条。

### 3.3 核心算法代码实现

第 2 章给出公式，本节给出与公式对应的实际 TypeScript 代码。为控制篇幅，代码为节选，省略调试采样、性能遥测、小丑鱼栖息和远景分支；省略处用注释标出。完整实现见 `src/`。

**（1）Boids 单鱼更新。** 代码 3-1 是 `BoidSystem.update()` 的邻居遍历。每条鱼只取一次候选邻居，然后在同一个循环中按不同半径分别累加分离、对齐和聚合；分离使用逆距离权重，对齐累加速度，聚合累加位置，因此不需要为每条鱼创建临时向量对象。

**代码 3-1：邻居遍历与三项行为累加（节选）**

```ts
const neighborCount = this.search.collect(i, radius, neighbors);
for (let n = 0; n < neighborCount; n += 1) {
  const other = neighbors[n];
  const otherOffset = other * 3;
  const dx = positions[otherOffset] - px;
  const dy = positions[otherOffset + 1] - py;
  const dz = positions[otherOffset + 2] - pz;
  const distanceSquared = dx * dx + dy * dy + dz * dz;

  if (distanceSquared <= separationRadiusSquared) {
    const inverse = 1 / (distanceSquared + 1e-4);
    separationX -= dx * inverse;
    separationY -= dy * inverse;
    separationZ -= dz * inverse;
  }
  // FOV clipping only applies to alignment and cohesion.
  if (!visible) continue;
  if (distanceSquared <= alignmentRadiusSquared) {
    alignmentX += velocities[otherOffset];
    alignmentY += velocities[otherOffset + 1];
    alignmentZ += velocities[otherOffset + 2];
    alignmentCount += 1;
  }
  if (distanceSquared <= cohesionRadiusSquared) {
    cohesionX += positions[otherOffset];
    cohesionY += positions[otherOffset + 1];
    cohesionZ += positions[otherOffset + 2];
    cohesionCount += 1;
  }
}
```

循环结束后，代码先把累加和转换为转向量：对齐项是邻居平均速度减去自身速度，聚合项是邻居平均位置减去自身位置；分离项保留逆距离加权和，不再除以邻居数，否则近距离重叠会被平均稀释。随后乘权重和密度缩放，得到本步加速度：

**代码 3-2：力合成、限幅与积分（节选）**

```ts
if (alignmentCount > 0) {
  alignmentX = alignmentX / alignmentCount - vx;
  alignmentY = alignmentY / alignmentCount - vy;
  alignmentZ = alignmentZ / alignmentCount - vz;
}
if (cohesionCount > 0) {
  cohesionX = cohesionX / cohesionCount - px;
  cohesionY = cohesionY / cohesionCount - py;
  cohesionZ = cohesionZ / cohesionCount - pz;
}
const separationScale = densityAwareSeparationScale(alignmentCount, config);
const separationForceX = separationWeight * separationScale * separationX;
const separationForceY = separationWeight * separationScale * separationY;
const separationForceZ = separationWeight * separationScale * separationZ;
const alignmentForceX = alignmentWeight * alignmentX;
const alignmentForceY = alignmentWeight * alignmentY;
const alignmentForceZ = alignmentWeight * alignmentZ;
const cohesionScale = densityAwareCohesionScale(alignmentCount, config);
const cohesionForceX = cohesionWeight * cohesionScale * cohesionX;
const cohesionForceY = cohesionWeight * cohesionScale * cohesionY;
const cohesionForceZ = cohesionWeight * cohesionScale * cohesionZ;
let ax = separationForceX + alignmentForceX + cohesionForceX;
let ay = separationForceY + alignmentForceY + cohesionForceY;
let az = separationForceZ + alignmentForceZ + cohesionForceZ;

// Escape, obstacle, boundary and habitat forces are added here.
const acceleration = Math.sqrt(ax * ax + ay * ay + az * az);
if (acceleration > maximumAcceleration) {
  const scale = maximumAcceleration / acceleration;
  ax *= scale;
  ay *= scale;
  az *= scale;
}
let nextVx = vx + ax * delta;
let nextVy = vy + ay * delta;
let nextVz = vz + az * delta;
// Speed and turn-rate clamps are applied here and omitted.
nextVelocities[offset] = nextVx;
nextVelocities[offset + 1] = nextVy;
nextVelocities[offset + 2] = nextVz;
nextPositions[offset] = px + nextVx * delta;
nextPositions[offset + 1] = py + nextVy * delta;
nextPositions[offset + 2] = pz + nextVz * delta;
```

这段代码体现了更新顺序：先由三项行为合成加速度，叠加逃逸、避障、边界和栖息力，再限制加速度长度；然后用 \(v'=v+a\Delta t\) 更新速度，限制速度和转向率，最后由 \(p'=p+v'\Delta t\) 写入 `nextPositions`。所有读取来自当前数组，所有写入进入 next 数组，避免同一步内读到其他鱼刚写入的新状态。

**（2）Uniform Grid 的构建与查询。** 代码 3-3 是 `UniformGrid3D.rebuild()` 的核心：先统计每个 cell 的鱼数，再用前缀和计算 `cellStart` 和写指针，最后把鱼索引写入连续 `cellItems`。这是计数排序，不创建每个 cell 的独立数组。

**代码 3-3：网格重建与 27 格查询（节选）**

```ts
this.cellSize = Math.max(0.001, radius);
const dimX = Math.max(1, Math.ceil((maxX - minX) / this.cellSize));
const dimY = Math.max(1, Math.ceil((maxY - minY) / this.cellSize));
const dimZ = Math.max(1, Math.ceil((maxZ - minZ) / this.cellSize));
cellCounts.fill(0);
for (let i = 0; i < flock.count; i += 1) {
  if (alive[i] === 0) continue;
  const offset = i * 3;
  const cx = clamp(Math.floor((positions[offset] - minX) / cellSize), 0, dimX - 1);
  const cy = clamp(Math.floor((positions[offset + 1] - minY) / cellSize), 0, dimY - 1);
  const cz = clamp(Math.floor((positions[offset + 2] - minZ) / cellSize), 0, dimZ - 1);
  const cellIndex = cx + dimX * (cy + dimY * cz);
  cellOf[i] = cellIndex;
  cellCounts[cellIndex] += 1;
}
let cursor = 0;
for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
  cellStart[cellIndex] = cursor;
  writeCursor[cellIndex] = cursor;
  cursor += cellCounts[cellIndex];
}
cellStart[cellCount] = cursor;
for (let i = 0; i < flock.count; i += 1) {
  if (alive[i] === 0) continue;
  const cellIndex = cellOf[i];
  cellItems[writeCursor[cellIndex]] = i;
  writeCursor[cellIndex] += 1;
}

for (let dz = -1; dz <= 1; dz += 1) {
  const gz = cz + dz;
  if (gz < 0 || gz >= dimZ) continue;
  for (let dy = -1; dy <= 1; dy += 1) {
    const gy = cy + dy;
    if (gy < 0 || gy >= dimY) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = cx + dx;
      if (gx < 0 || gx >= dimX) continue;
      const cellIndex = gx + dimX * (gy + dimY * gz);
      const start = cellStart[cellIndex];
      const end = start + cellCounts[cellIndex];
      for (let item = start; item < end; item += 1) {
        const other = cellItems[item];
        if (other === index) continue;
        const otherOffset = other * 3;
        const ox = positions[otherOffset] - x;
        const oy = positions[otherOffset + 1] - y;
        const oz = positions[otherOffset + 2] - z;
        if (ox * ox + oy * oy + oz * oz <= radiusSquared) {
          output[found] = other;
          found += 1;
        }
      }
    }
  }
}
```

因为 `cellSize` 取最大感知半径，查询球不会超出自身及相邻 26 个 cell；但网格只负责产生候选，最终仍用平方距离精确筛选每个行为的邻居集合。`collect` 不包含任何 Boids 规则，所以网格和暴力搜索共用同一套行为公式，二者只在候选来源上不同。

**（3）捕食者预测追逐与捕获。** 代码 3-4 是捕食者从追逐进入攻击、再由攻击进入搜索的核心分支。追逐目标不是猎物当前位置，而是按猎物速度前推的预测位置；前推时间受距离和捕食者速度限制，系数 0.8 抑制过冲。捕获只在 `attack` 状态且 `flock.remove()` 真正成功时计数，因此 UI 中的捕获数与模拟数组一致。

**代码 3-4：预测追逐、攻击转换与真实捕获（节选）**

```ts
const distance = Math.hypot(dx, dy, dz);
if (this.state === 'pursuit' && distance > this.config.predatorLoseRadius
    && this.stateTime > 1) {
  this.targetIndex = -1;
  this.transition('search');
} else {
  const leadTime = clamp(
    distance / Math.max(1, Math.hypot(...this.velocity)), 0, 1.1,
  );
  targetX = flock.positions[offset] + flock.velocities[offset] * leadTime * 0.8;
  targetY = flock.positions[offset + 1]
    + flock.velocities[offset + 1] * leadTime * 0.8;
  targetZ = flock.positions[offset + 2]
    + flock.velocities[offset + 2] * leadTime * 0.8;
  desiredSpeed = this.config.predatorPursuitSpeed * (0.8 + aggression * 0.25);
  if (this.state === 'pursuit' && distance < this.config.predatorAttackRadius) {
    this.transition('attack');
  } else if (this.state === 'attack' && this.stateTime > 0.55) {
    this.targetIndex = -1;
    this.detectCooldown = 1.2;
    this.transition('search');
  }
}

if (this.state === 'attack' && this.targetIndex >= 0) {
  const offset = this.targetIndex * 3;
  const distance = Math.hypot(
    flock.positions[offset] - this.position[0],
    flock.positions[offset + 1] - this.position[1],
    flock.positions[offset + 2] - this.position[2],
  );
  if (distance < this.config.predatorCaptureRadius
      && flock.remove(this.targetIndex)) {
    this.captures += 1;
    this.captureSerial += 1;
    this.targetIndex = -1;
    this.detectCooldown = 1.6;
    this.setSearchTargetAhead();
    this.transition('search');
  }
}
```

`pursuit` 在目标丢失或超出丢失半径后转入 `search`；`attack` 持续超过 0.55 s 也会回到 `search`，避免捕食者无限尾随。捕获成功后把目标索引置为 -1、设置冷却并让搜索目标落在前方，避免下一次更新继续追一条已经不存在的鱼。

**（4）障碍避让与安全投影。** 代码 3-5 先计算当前位置和短时预测位置；只有当前位置或预测位置进入安全边界时才施加排斥力。预测项使鱼在真正接触礁石之前开始转向；切向项让鱼沿礁石表面绕行，而不是正对障碍反弹。积分后 `ObstacleSystem.constrain()` 再把已经进入安全边界的鱼投影到表面，并消除向内的速度，作为硬约束。

**代码 3-5：预测避障与切向绕行（节选）**

```ts
const lookAhead = config.obstacleLookAhead;
const futureX = x + vx * lookAhead;
const futureY = y + vy * lookAhead;
const futureZ = z + vz * lookAhead;
// ...
if (currentDistanceSquared >= clearanceSquared
    && predictedDistanceSquared >= clearanceSquared) continue;
const currentDistance = Math.sqrt(currentDistanceSquared);
const predictedDistance = Math.sqrt(predictedDistanceSquared);
const strength = Math.min(1, Math.max(
  (clearance - currentDistance) / margin,
  (clearance - predictedDistance) / margin,
  0,
));
let nx = useCurrent ? currentX : predictedX;
let ny = useCurrent ? currentY : predictedY;
let nz = useCurrent ? currentZ : predictedZ;
let distance = useCurrent ? currentDistance : predictedDistance;
nx /= distance;
ny /= distance;
nz /= distance;

const force = forceScale * strength * strength;
output[0] += nx * force;
output[1] += ny * force;
output[2] += nz * force;

let tx = -nz;
let tz = nx;
if (tx * vx + tz * vz < 0) {
  tx = -tx;
  tz = -tz;
}
output[0] += tx * force * 0.38;
output[2] += tz * force * 0.38;
```

`strength` 使用二次衰减，越接近安全边界排斥越强；切向分量与当前水平速度对齐，保证鱼沿障碍的同一侧绕行。`?obstacleShape=reefProxy` 使用同一套预测和切向公式，只把球体距离替换为复合 SDF 距离，失败时回退球体。

**（5）固定步双缓冲与渲染插值。** 代码 3-6 是 `FlockData.beginStep()` 和 `swap()`：每步开始时把当前位置复制到 `previousPositions` 供渲染插值，所有鱼写完后统一交换当前与 next 数组。渲染阶段用插值系数 `alpha` 在上一位置和当前位置之间插值，并用四元数把鱼体前方向旋转到速度方向，再乘上倾斜角。

**代码 3-6：双缓冲交换与实例朝向（节选）**

```ts
beginStep(): void {
  this.previousPositions.set(this.positions);
  this.previousBanks.set(this.banks);
}

swap(): void {
  [this.positions, this.nextPositions] = [this.nextPositions, this.positions];
  [this.velocities, this.nextVelocities] = [this.nextVelocities, this.velocities];
  [this.banks, this.nextBanks] = [this.nextBanks, this.banks];
  [this.fear, this.nextFear] = [this.nextFear, this.fear];
}

this.dummy.position.set(
  MathUtils.lerp(previousPositions[offset], positions[offset], alpha),
  MathUtils.lerp(previousPositions[offset + 1], positions[offset + 1], alpha),
  MathUtils.lerp(previousPositions[offset + 2], positions[offset + 2], alpha),
);
// ...
this.dummy.quaternion.setFromUnitVectors(FORWARD, this.direction);
const bank = MathUtils.lerp(previousBanks[i], banks[i], alpha);
this.bankRotation.setFromAxisAngle(FORWARD, bank);
this.dummy.quaternion.multiply(this.bankRotation);
```

双缓冲保证同一步内所有鱼都基于同一份快照计算；交换只改变数组引用，不复制 2000 条鱼的数据。渲染使用 `previousPositions` 和 `positions` 插值，因此固定 60 Hz 模拟在更高刷新率显示器上仍然平滑。`setFromUnitVectors` 直接构造从局部 +Z 到速度方向的四元数，避免欧拉角在俯仰接近 ±90° 时的万向节死锁；倾斜四元数再绕局部前方向叠加。

### 3.4 渲染与最终视觉

每条鱼由低多边形身体、缩小的尾鳍、背鳍和两片胸鳍合并而成，局部 +Z 指向鱼头，尾鳍位于 -Z。`InstancedMesh` 使用单个 draw call 绘制最多 2000 条鱼。顶点 shader 根据 `position.z` 和每条鱼的相位 `instancePhase`、速度 `instanceSpeed` 让身体后部周期摆动；每条鱼相位不同，避免整群同步摆尾。鱼的朝向由速度方向确定，模拟中记录的转弯角速度生成平滑倾斜。

捕食者使用独立的暖铜色材质，与冷色鱼群形成明确异色关系；攻击时颜色进一步转暖。体型约为猎物鱼的数倍，并使用单独的尾鳍枢轴摆动，运动方向与其速度一致。礁石使用与避障球体一致的坐标，外圈增加碎块、分枝珊瑚和轻微自发光；另有位于模拟边界外的雾中远景岩体，用于海底纵深而不参与碰撞。灯光由冷色半球光、顶部方向光和蓝绿色侧向补光构成，海底网格透明度降低，避免背景比鱼群抢眼。

![提交版运行画面：(a) 默认场景整体群游与礁石环境；(b) 捕食者追逐下的逃逸与群体分裂；(c) 小丑鱼在礁石海葵处的栖息行为；(d) 鱼体姿态、转弯倾斜与尾鳍细节](../screenshots/fig-final-visual.png)

图 1 用四个画面给出提交版的最终视觉与行为证据。（a）是默认场景的整体构图：主鱼群、礁石礁体、珊瑚和小丑鱼处在同一水域中，能看到雾中远景带来的纵深；（b）是捕食者追逐时的画面，当时的逃逸范围与受惊鱼数量直接显示在画面提示里，鱼群在捕食者前方散开并在两侧形成新的局部结构；（c）是固定机位下的小丑鱼与海葵，小丑鱼群聚在礁石表面而不是跟随主鱼群；（d）是鱼体特写，可见身体、胸鳍、背鳍与尾鳍的形态差异，以及转弯时的俯仰和倾斜。四幅截图由项目 Phase E1/E3/E4 证据脚本在真实运行中捕获，硬件与软件渲染画面均有，仅用于展示最终视觉与行为，不代表硬件性能；帧率与耗时结论以 4.3 节为准。

UI 采用深海观测仪方向：主画面占据中央，右侧为可折叠参数面板，底部显示存活数、FPS、步耗时、捕食状态和模拟时间。移动端面板变为抽屉，并保持主画面 390 px 宽度无横向溢出。图形不依赖外部模型、纹理或预设鱼群轨迹。

## 4. 环境与运行

### 4.1 开发与测试环境

表 2 区分两类环境：自动测试、CPU 基准与受控实验在沙箱内完成，硬件性能验收在本机 Windows 上完成。

表 2：开发、测试与验收环境

| 项目 | 值 | 用途 |
| --- | --- | --- |
| 本机操作系统 | Windows 11 Home China 10.0.26300 | 硬件验收环境 |
| 本机浏览器 / GPU | Chrome 157 / Intel Iris Xe Graphics（D3D11 后端，1280×720，DPR 1） | 硬件验收环境 |
| 当前验证沙箱 | Linux 6.8.0-138-generic（Ubuntu 22.04），2 个逻辑核 | 自动测试、CPU 基准与受控实验 |
| Node.js / npm（沙箱） | 22.23.4 / 10.9.9 | 基准与实验运行 |
| 浏览器（沙箱） | Playwright Chromium 158.0.8127.18 | 功能 smoke 与截图 |
| 浏览器图形后端（沙箱） | SwiftShader 软件光栅化（ANGLE/Vulkan） | 仅作功能与视觉证据 |

`package-lock.json` 记录的顶层实际版本包括：Three.js 0.180.0、TypeScript 5.9.3、Vite 7.3.7、Vitest 3.2.7、tsx 4.23.15、Playwright 1.65.0、@types/node 24.19.2。所有依赖均来自 npm 清单，没有本机绝对路径。

### 4.2 安装与启动

```bash
cd Project/BlueCurrent
npm ci
npm run dev       # Vite 开发服务器
npm run build     # TypeScript 检查 + 生产构建
npm run preview   # 预览 dist/
npm test          # 52 文件 / 400 tests
```

实际可用脚本以 `package.json` 为准：`dev`、`build`、`preview`、`test`、`test:watch`、`benchmark`、`experiment:ablation`、`experiment:predator`、`experiment:predator:merge`、`figures`、`capture:demo`、`smoke`。

首次运行浏览器验收需额外安装：

```bash
npx playwright install chromium
npm run smoke
```

程序默认加载 `public/models/` 下的 GLB 鱼、小丑鱼、捕食者、礁石、珊瑚、海带等本地资产，并保留程序化回退路径；资产不依赖网络，完整源码包已包含 `public/`。

### 4.3 沙箱与本机的区别

沙箱的 CPU 基准运行在分配给当前进程的 2 个逻辑核上；浏览器通过 SwiftShader 软件渲染，截图中的 2–20 FPS 仅说明页面能实际渲染和交互，不能代表用户 Windows 机器上的硬件 GPU 性能。窗口缩放（1440×900）、压力档与长时间热稳定性尚未完成有效验证，因此当前只在 1280×720 标准档下标记为通过。

2026-11-14/15 已在本机 Windows 11、Chrome 157、Intel Iris Xe Graphics D3D11 上完成硬件验收：rich-default 500+100+1 在 1280×720、telemetry-off 的 standard 三 repeats 中，三次均满足本项目设定的实时运行验收条件（P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped）。这一门槛是自定义验收条件，不等价于“每一帧都严格低于 16.7 ms”。验收路径关闭遥测，GPU 时间项为 N/A；本报告只用帧时间与 dropped 计数判定。演示视频 `submission/Demo.mp4` 在同一硬件上录制；录制与后台负载会影响视频中的 FPS 读数，因此视频不作为性能基准。

## 5. 实验与结果

完整原始数据、图表和逐项分析见 `BENCHMARK_RESULTS.md` 与 `benchmarks/`。以下为课程报告需要的主要结论，均基于 2026-11-08 初版模型上的受控实验。

这些实验针对基础算法模型（邻居搜索、Boids 规则与捕食逃逸）设计，不能替代对提交版新增物种、群体行为与场景资产的验证。提交版新增内容的运行验收与视觉证据分别见 4.3 节与 3.4 节；两组结果具有不同的验证目的，不混合解释。

### 5.1 实验一：暴力搜索与 Uniform Grid

500 条、2000 条鱼的两个关键结果：

表 3：暴力搜索与 Uniform Grid 的平均步耗时（3 次重复均值，无渲染）

| 鱼数 | 暴力平均 ms | 网格平均 ms | 加速比 | 网格候选/暴力候选 |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 9.454 | 8.341 | 1.13× | 199,052 / 249,500 |
| 2000 | 86.222 | 68.642 | 1.26× | 2,178,519 / 3,998,000 |

![实验一：性能](../screenshots/fig-performance.png)

环境与参数：Node.js v22.23.4、2 逻辑核 i7-13700H Linux 沙箱；120 测量步 × 3 重复、40 预热步、无渲染、捕食者关闭；单位 ms；来源 `benchmarks/performance-grid-vs-brute.json`。

100 条鱼时网格为 0.85×，250、500、1000、2000 条时分别为 1.07×、1.13×、1.18×、1.26×。小规模不占优是因为重建网格和 27 格遍历的固定成本大于节省的距离检查；规模增大时收益增加，但密集群体使平均邻居数和候选数仍然很高，因此没有出现与理论复杂度同幅度的下降。

### 5.2 实验二：Boids 消融

![实验二：规则消融](../screenshots/fig-ablation.png)

500 条鱼、3 种子、300 预热 + 600 测量、无捕食者；采样间隔 30 步；来源 `benchmarks/ablation-results.json`。表中数值为 3 个种子的均值 ± 样本标准差（\(n-1\) 分母）。

表 4：三种 Boids 配置的群体指标（3 种子均值 ± 标准差）

| 配置 | 平均 \(R_g\) | 方向一致性 | 群体数 | 主群体占比 |
| --- | ---: | ---: | ---: | ---: |
| 仅 Separation | 14.694 ± 0.065 | 0.336 ± 0.007 | 8.217 ± 0.333 | 0.637 ± 0.010 |
| Separation + Alignment | 12.454 ± 0.024 | 0.397 ± 0.005 | 1.233 ± 0.076 | 0.915 ± 0.031 |
| 三规则 | 8.134 ± 0.185 | 0.712 ± 0.007 | 1.000 ± 0.000 | 1.000 ± 0.000 |

仅分离时群体扩散并分裂，说明单纯的排斥不能形成整体；加入对齐后主群体比例明显上升，但全局方向一致性仍较低；完整三规则在空间聚合和方向协调上同时改善。三个种子的标准差均明显小于配置间差异（例如 \(R_g\) 的组内标准差最大为 0.185，而三规则与仅分离相差约 6.6），因此趋势不是单次运行造成的。结果对应默认权重，不能外推为所有参数组合的最优。

### 5.3 实验三：捕食者、分裂与恢复

![实验三：捕食者响应](../screenshots/fig-predator.png)

500 条鱼、1 条捕食者、3 种子；600 步稳定、600 步威胁、1200 步恢复；每 15 步采样；来源 `benchmarks/predator-results.json`。指标定义与统计口径见 3.2 节表 1；表中数值为 3 个种子的均值 ± 样本标准差，捕获/运行先对单次运行取值、再对 3 个种子平均。

表 5：四种捕食条件下的群体响应（3 种子均值 ± 标准差）

| 条件 | 受惊鱼均值 | 威胁期 \(R_g\) | 严格最大群体数 | 捕获/运行 | 恢复期宽群体数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 无捕食者 | 0 | 12.000 ± 0.418 | 2.0 ± 1.0 | 0 | 1.075 ± 0.130 |
| 仅巡逻 | 0 | 12.000 ± 0.418 | 2.0 ± 1.0 | 0 | 1.075 ± 0.130 |
| 追逐、无逃逸 | 0 | 11.990 ± 0.417 | 2.0 ± 1.0 | 3.000 ± 0.000 | 1.108 ± 0.188 |
| 追逐 + 逃逸 | 41.84 ± 3.79 | 11.777 ± 0.764 | 4.0 ± 1.7 | 0.667 ± 0.577 | 1.992 ± 0.287 |

无捕食者和仅巡逻的控制结果相同，说明捕食者只有通过追逐/捕获或逃逸规则才影响群体。追逐但无逃逸时捕获了鱼，却没有显著空间扰动；启用逃逸后出现受惊鱼、严格阈值下的分裂，并在 20 s 恢复窗口结束时保留约两个宽连通群体，没有完全恢复为单一群体。捕获/运行与恢复期宽群体数出现小数，是因为它们先按时间窗口取平均、再对 3 个种子取平均；例如“追逐 + 逃逸”三次运行分别捕获 1、1、0 条，均值为 0.667。

控制组的 \(R_g\) 在威胁观察期也从 6.79 升至 12.00，说明该指标自身受自然群体运动和边界影响；因此报告不把 \(R_g\) 变化单独归因于捕食者，而把受惊数量、连通分量和独立控制组作为联合证据。

## 6. 问题与局限

**群体模型局限。** Boids 只对位置和速度做局部平均，不包含真实鱼类的鳍动力学、视觉遮挡、身体碰撞或物种差异。分离力能降低重叠概率，但不能提供严格接触约束。三个默认权重通过调试选择，并非从生物测量拟合。

**障碍处理局限。** 礁石仅由五个球体表示，适用于凸形近似；复杂凹形礁洞、薄片和动态障碍不在范围内。前瞻避让对高速、极小障碍和多个障碍夹缝没有专门验证。

**捕食者局限。** 只有一个捕食者、一种追逐模型，检测是半径内最近目标而非遮挡或视觉锥。捕获是离散移除，不包含伤害、能量或群体学习。现有实验不能说明多捕食者协同效应。

**性能局限。** 当前为 CPU 模拟和 CPU 网格，2000 条鱼在沙箱中平均步耗时约 68.6 ms，低于 60 Hz 所需的 16.7 ms；1500 条截图中的 UI FPS 也来自 SwiftShader，不能当作硬件性能。受控实验只包含 3 个种子和 120 个性能测量步的当前沙箱条件。

**视觉与验证局限。** 当前视觉为风格化低多边形 GLB 资产，没有写实鳞片、焦散或体积光。已在本机硬件 GPU 上完成 1280×720 标准档 FPS 复测、桌面/移动 smoke、截图和最终演示视频；仍未完成的是 3/5 捕食者完整矩阵、pressure telemetry-off 的 cadence decay 复现、1440×900 的有效 gate 以及 GPU/compositor 成本归因。视频中的实时 FPS 读数受屏幕录制和后台负载影响，只作演示，不作为性能数据。

## 7. 总结

本项目打通了从局部 Boids 规则、统一邻居查询、捕食者状态机到实例化三维渲染和实时统计的完整链路。技术重点在于：两种邻居搜索共享同一套行为更新，因而可做受控性能实验；SoA 双缓冲与固定步长避免顺序依赖；捕食者通过真实目标选择、攻击和捕获改变模拟状态，而不是预设追逐动画；界面指标均可追溯到模拟数组或事件。3.4 节的四个运行画面给出了提交版的视觉证据。

实验方面，5.1–5.3 的初版受控实验表明：500–2000 条鱼时网格相对暴力搜索有 1.13–1.26× 实测收益；三规则配置方向一致性最高、回旋半径最低；捕食者效应主要由逃逸规则产生，20 s 恢复窗口后仍有残余局部群体。

后续工作分两个方向：一是减少邻居查询与力计算的重复工作，在保持精确邻居集合和浮点求和顺序的前提下评估 Worker/WASM/SIMD 并行；二是补足 3/5 捕食者压力场景、长时间热稳定性和 1440×900 有效 gate，并用 GPU timer 与 compositor 归因区分渲染、呈现和 CPU 成本。任何优化都应先定义可复现指标和回退条件，不以降低默认画质、鱼数或生态行为为代价。

## 8. 参考资料与资源来源

1. Reynolds, C. W. 1987. *Flocks, herds and schools: A distributed behavioral model*. Proceedings of SIGGRAPH '87, 25–34. 本项目 Boids 分离/对齐/聚合三条规则的原始文献。
2. three.js：官方文档 https://threejs.org/docs/ ，仓库 https://github.com/mrdoob/three.js （MIT 许可）；用于场景、`GLTFLoader`、实例化渲染与 GPU timer 查询。
3. Blender：https://docs.blender.org/ ；blender-mcp 桥接 https://github.com/ahujasid/blender-mcp ；用于 GLB 建模与导出，见 `docs/BLENDER_MCP_SETUP.md`。
4. 资产来源与许可：鱼、小丑鱼、珊瑚、海带、礁石与地形等 GLB 由本项目 Blender 流程生成，贴图脚本生成并嵌入 GLB，未使用商业模型或扫描资产（`docs/ASSET_PIPELINE.md`）；捕食者 `shayu.glb` 由用户提供并转为 `predator_shayu.glb`（`docs/ASSET_SPEC.md`），均本地加载、不访问网络。
5. 工具：TypeScript、Vite、Vitest、Playwright、tsx（版本见 `package-lock.json`）；Pandoc 与 XeLaTeX 排版。
