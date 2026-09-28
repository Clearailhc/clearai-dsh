#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建"抽象"热梗样本语料库(s1-sample)。

输出三件产物:
  1. lab/data/meme_samples.csv   —— 机器可读语料(UTF-8-sig,字段用 | 分隔多值)
  2. lab/data/meme_samples.md    —— 人读速查表
  3. lab/data/meme_samples_check.txt —— 一致性校验报告

设计原则:
  - 每条的 URL 与出处必须是本次调研中真实读到的,未核实者写 UNKNOWN 并降证据等级;
  - 不在脚本里编造来源;宁可少一条,不伪造一个出处。
"""

from __future__ import annotations

import csv
import os
from collections import Counter

CSV_FIELDS = [
    "id", "name", "year", "origin", "mechanism", "dereference",
    "called_abstract", "evidence_level", "url", "note",
]

# 证据等级(沿用 scientific-critical-thinking 的简化 GRADE 口径):
#   H = 多源一致且可复核(权威媒体亲读原文)
#   M = 单源权威或部分复核(一家媒体/一次亲读)
#   L = 推断、媒体转述、自媒体,或来源未取到正文
SAMPLES = [
    # ---------- A 空耳族:跨语言/跨音节音变,所指在传播中脱落 ----------
    dict(id="m001", name="我的刀盾", year="2026", origin="英文短句 \"What the dog doing?\" 被空耳误听(搞笑视频博主)",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻记者走访杭州小学亲读原文;央视网2026-06-13报道列其为校园高频口头禅"),
    dict(id="m002", name="比比拉布", year="2026", origin="外网博主的搞笑发音/音效,无具体含义",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻原文:'起源一个外网博主的搞笑发音,没有具体含义'"),
    dict(id="m003", name="哈基米", year="2023", origin="日语「はちみつ」(蜂蜜)空耳,源出《赛马娘》第二季《蜂蜜之歌》;2022-11-19 B站音MAD为关键二创节点",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="https://zh.wikipedia.org/zh-hant/%E5%93%88%E5%9F%BA%E7%B1%B3_(%E7%BD%91%E7%BB%9C%E7%94%A8%E8%AF%AD)", note="★语义三度迁移:蜂蜜→猫→任何小巧可爱之物,又被'爱猫TV'反向污染。是'从未有正确所指'的极端样本"),
    dict(id="m004", name="刀马刀马(刀马舞)", year="2025", origin="2025年夏魔性BGM+手势舞全网模仿;2025年10月'瓦瓦捷风版'二次爆发",
         mechanism="动作模仿", dereference="脱义", called_abstract="是", evidence_level="M",
         url="https://lol.dianjinghu.com/original/news/detail/99310.html", note="行业自媒体,时间点明确但未查到最初原创博主(本次未查实的缺口);2026-07后被玩家赋予多重义"),
    dict(id="m004b", name="蒸蚌", year="2026", origin="博主「超级无敌大开门」训猫视频中夸张夸赞「真棒!」被空耳",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="M",
         url="https://www.digitaling.com/articles/1561293.html", note="数英《2026上半年网络热词TOP30》第29条;梗源叙述属'网友说法'级"),
    dict(id="m004c", name="样人笑幻", year="2026", origin="东北方言「让人笑话」的谐音空耳",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="M",
         url="https://www.digitaling.com/articles/1561293.html", note="同上第28条"),
    dict(id="m004d", name="我chovy(我超威)", year="2026", origin="演员谢孟伟(嘎子)带货直播中为规避平台规范改写脏话",
         mechanism="谐音/回避审查", dereference="脱义", called_abstract="是", evidence_level="M",
         url="https://www.digitaling.com/articles/1561293.html", note="同上第20条"),
    dict(id="m004e", name="你不知道我的身材很曼妙", year="2026", origin="短视频答非所问式回应",
         mechanism="句式模板", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻原文列为家长被怼的口头禅"),
    dict(id="m004f", name="药水哥式直播整活", year="2017+", origin="虎牙主播刘波直播行为艺术",
         mechanism="行为整活", dereference="部分脱义", called_abstract="是", evidence_level="M",
         url="https://www.bianews.com/news/details?id=238808", note="差评文把'影流之主、奥利给'等与鬼畜区并列;行为整活族的代表"),
    dict(id="m004g", name="奥利给/影流之主", year="2019", origin="短视频喊话与舞蹈整活",
         mechanism="行为整活", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://m.thepaper.cn/newsDetail_forward_33154563", note="澎湃文列为当年鬼畜区各占山头的素材"),

    # ---------- B 动作族:身体动律被抽离原语境 ----------
    dict(id="m005", name="闪身步", year="2026", origin="安徽花鼓灯国家级非遗(2006首批)训练动作,赵铁春(中国舞协副主席)2018年前后教学视频",
         mechanism="动作模仿", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.thepaper.cn/newsDetail_forward_34158213", note="澎湃·果壳亲读;教学视频躺了八年被翻出;对舞蹈专业者是严肃教学,对短视频观众成抽象"),
    dict(id="m006", name="狗熊哆嗦毛", year="2026", origin="山东鼓子秧歌(国家级非遗)训练动作,明文军(曾任文旅部艺术司司长)教学视频",
         mechanism="动作模仿", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.thepaper.cn/newsDetail_forward_34158213", note="同上;原文'一本正经地做一件好笑的事'"),
    dict(id="m007", name="企鹅舞", year="2025", origin="网络平台舞蹈,青年集体模仿",
         mechanism="动作模仿", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》林爱珺文与'技能五子棋'并列提及"),
    dict(id="m008", name="技能五子棋", year="2025", origin="网络平台整活玩法",
         mechanism="行为整活", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》原文并列提及"),
    dict(id="m009", name="刀盾狗/自制刀盾形象", year="2026", origin="由'我的刀盾'衍生的自制玩偶与表情包",
         mechanism="二创衍生", dereference="部分脱义", called_abstract="是", evidence_level="M",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻配图显示流行口头禅的周边小玩具"),

    # ---------- C 谐音族与 D 复读族 ----------
    dict(id="m010", name="薛甄珠找凌玲", year="2017→2026", origin="电视剧《我的前半生》(2017)薛甄珠冲到公司找凌玲的桥段,2026年翻红;网民误写作'zhenzhu找小三'",
         mechanism="台词复用", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://k.sina.cn/article_7517400647_1c0126e47059096y9k.html", note="今晚报《网络新词语》专栏(2026-09-08);百度百科已单独立条。**非网络原生梗**,是电视剧桥段翻红"),
    dict(id="m011", name="华强买瓜", year="2021→2026", origin="2003年电视剧《征服》第9集刘华强买瓜片段(孙红雷)",
         mechanism="AI二创/台词复用", dereference="半脱义", called_abstract="是", evidence_level="H",
         url="https://m.thepaper.cn/newsDetail_forward_33154563", note="2026年靠AI视频生成翻红,成'什么都能往里装的故事容器';B站近月登热门200余次"),
    dict(id="m012", name="雪山救狐狸", year="2026", origin="2026年春节AI短片,'你是否在雪山上救过一只狐狸'",
         mechanism="AI二创", dereference="半脱义", called_abstract="是", evidence_level="H",
         url="https://m.thepaper.cn/newsDetail_forward_33154563", note="#酱板鸭#话题累计播放破50亿;48小时内3000多条衍生变体,后沦为'数字泔水'"),
    dict(id="m013", name="何意味", year="2026", origin="日语'什么意思'的汉字直译式借用",
         mechanism="谐音/外来借用", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻报道列为最新款口头禅;有家长模仿反被孩子斥'你不懂就别问'"),
    dict(id="m014", name="那咋了", year="2026", origin="短视频口头禅,万能应答句式",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="http://sdxw.iqilu.com/share/YS0yMS0xNzI0OTc4OA.html", note="央视网2026-06-13报道点名'那咋了''受着呗'"),
    dict(id="m015", name="受着呗", year="2026", origin="短视频口头禅,与'那咋了'配套",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="http://sdxw.iqilu.com/share/YS0yMS0xNzI0OTc4OA.html", note="同上"),
    dict(id="m016", name="我要验牌", year="2026", origin="电影《赌侠2:上海滩赌圣》台词",
         mechanism="台词复用", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻亲读并给出电影出处;央视网列为校园烂梗"),
    dict(id="m017", name="因为他善", year="2024", origin="短视频口头禅(通行写法为'因为他善';用户所写'因为我善'为变体)",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://baike.baidu.com/item/%E5%9B%A0%E4%B8%BA%E4%BB%96%E5%96%84", note="游侠梗百科2024榜收录,故属2024年梗而非2025;百度百科页为JS空壳,证据等级降为M"),
    dict(id="m018", name="包的", year="2026", origin="网络黑话('保证'的谐音)",
         mechanism="谐音", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="https://finance.sina.com.cn/jjxw/2025-11-05/doc-infwismz2962038.shtml", note="央视新闻热评点名'包的''我嘞个逗''666'"),
    dict(id="m019", name="我嘞个逗", year="2026", origin="方言谐音感叹",
         mechanism="谐音", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="https://finance.sina.com.cn/jjxw/2025-11-05/doc-infwismz2962038.shtml", note="同上"),
    dict(id="m020", name="栓Q", year="2022", origin="英文 thank you 的空耳",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="M",
         url="UNKNOWN", note="空耳族经典样本;本轮未取到权威出处正文"),
    dict(id="m021", name="尊嘟假嘟", year="2023", origin="'真的假的'的卖萌式谐音",
         mechanism="谐音", dereference="部分脱义", called_abstract="是", evidence_level="M",
         url="UNKNOWN", note="谐音族样本"),
    dict(id="m022", name="芭比Q了", year="2021", origin="英文 barbecue 空耳",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="http://www.news.cn/politics/20251104/014e7ab57cde4765be377d99029fa388/c.html", note="新华社新华视点亲读原文并点名"),
    dict(id="m023", name="你好唐", year="2025", origin="以'唐'指代唐氏综合征的侮辱性用法",
         mechanism="谐音/贬义改编", dereference="部分脱义", called_abstract="否", evidence_level="H",
         url="http://www.news.cn/politics/20251104/014e7ab57cde4765be377d99029fa388/c.html", note="新华社原文:'唐人'意指他人有唐氏综合征。属校园语言霸凌,官方定性为烂梗而非抽象"),
    dict(id="m024", name="你个双肩包", year="2025", origin="'你个神经病'的谐音",
         mechanism="谐音", dereference="部分脱义", called_abstract="否", evidence_level="H",
         url="http://www.news.cn/politics/20251104/014e7ab57cde4765be377d99029fa388/c.html", note="新华社原文点名,同属语言霸凌类烂梗"),
    dict(id="m025", name="yyds", year="2021", origin="'永远的神'拼音首字母缩写",
         mechanism="缩写", dereference="弱脱义", called_abstract="否", evidence_level="H",
         url="http://paper.people.com.cn/rmrb/pc/content/202510/30/content_30112156.html", note="人民日报第10版亲读;被批评为'赞美的万能标签'"),
    dict(id="m026", name="绝绝子", year="2021", origin="网络赞美套话",
         mechanism="句式模板", dereference="弱脱义", called_abstract="否", evidence_level="H",
         url="http://paper.people.com.cn/rmrb/pc/content/202510/30/content_30112156.html", note="人民日报点名;属'热梗'但一般不被称抽象"),
    dict(id="m027", name="666", year="2018", origin="数字谐音'溜'",
         mechanism="谐音", dereference="弱脱义", called_abstract="否", evidence_level="H",
         url="https://finance.sina.com.cn/jjxw/2025-11-05/doc-infwismz2962038.shtml", note="央视新闻热评点名"),
    dict(id="m028", name="鸡你太美", year="2019", origin="蔡徐坤选秀节目台词空耳",
         mechanism="空耳/鬼畜", dereference="完全脱义", called_abstract="是", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="差评文列为鬼畜区黄金期代表作;2019年律师函导致下架。中文形式不构成合法语义,判为完全脱义"),

    # ---------- E 事件驱动族 ----------
    dict(id="m029", name="马保国/接化发/不讲武德", year="2020", origin="武术界人物马保国的真实比赛与采访视频(事件驱动)",
         mechanism="事件驱动", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="差评文列为鬼畜区山头之一;2020年11月人民日报批评后B站限制审核。以真实人物真实事件为素材,故主族为事件驱动族而非鬼畜"),
    dict(id="m030", name="听我说谢谢你", year="2022", origin="抗疫手势舞儿歌",
         mechanism="动作模仿/场景复用", dereference="弱脱义", called_abstract="否", evidence_level="L",
         url="UNKNOWN", note="反例候选:由明确语境驱动,含义清晰,通常被称'烂梗'而非'抽象'"),
    dict(id="m031", name="大展鸿图", year="2025", origin="粤语说唱歌曲及舞蹈挑战",
         mechanism="动作模仿", dereference="弱脱义", called_abstract="待判", evidence_level="M",
         url="https://turnnewsapp.com/livenews/chinav3/20250719002944-260409", note="关键反例候选:同样是全民模仿的魔性舞蹈,但意义与情绪明确——用来检验'抽象'与'魔性挑战'的边界"),

    # ---------- F 外来借用族 ----------
    dict(id="m032", name="What the dog doing?", year="2024", origin="英文母梗,我的刀盾的源头",
         mechanism="跨语言对照", dereference="原义完整", called_abstract="否", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="跨语言证据:同一形式在英语圈指'那只狗在干什么',进入中文后脱义成'我的刀盾'。归属参照族 F0 而非 F1——它是镜子的另一面,不是抽象现象成员"),
    dict(id="m033", name="比博燃", year="2020", origin="日语借用/谐音",
         mechanism="外来借用", dereference="部分脱义", called_abstract="是", evidence_level="L",
         url="UNKNOWN", note="待补证"),
    dict(id="m034", name="欧金金", year="2022", origin="日语空耳借用",
         mechanism="外来借用", dereference="完全脱义", called_abstract="是", evidence_level="L",
         url="UNKNOWN", note="待补证"),

    # ---------- G 话语套路族(抽象话本体) ----------
    dict(id="m035", name="抽象话", year="2015", origin="斗鱼6324直播间/抽象工作室的话语形式",
         mechanism="话语体系", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://baike.baidu.com/item/%E6%8A%BD%E8%B1%A1%E8%AF%9D/2116047", note="百度百科原文:'大量脏话、emoji、拼音首字母缩写、四川方言及直播间相关梗'"),
    dict(id="m036", name="抽象工作室", year="2015-09-01", origin="李赣成立,直播间更名'抽象TV','抽象'由此得名",
         mechanism="机构命名", dereference="原义完整", called_abstract="是", evidence_level="H",
         url="https://baike.baidu.com/item/%E6%8A%BD%E8%B1%A1%E8%AF%9D/2116047", note="命名起点:2013年李赣在AcFun 6324开播,2014年转斗鱼,2015-09-01成立工作室"),
    dict(id="m037", name="废话文学", year="2021", origin="网络文体:说了等于没说",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="https://wapbaike.baidu.com/item/%E7%8E%A9%E6%8A%BD%E8%B1%A1/1789915532", note="百度百科'玩抽象'原文列为核心要义之一:一本正经胡说八道"),
    dict(id="m038", name="发疯文学", year="2021", origin="网络文体:以极端情绪文字表达诉求",
         mechanism="句式模板", dereference="弱脱义", called_abstract="否", evidence_level="L",
         url="UNKNOWN", note="邻近概念,需判定与抽象的关系"),

    # ---------- H 行为整活族 ----------
    dict(id="m039", name="抽象直播/猎奇整活", year="2013", origin="李赣6324直播间的猎奇直播风格",
         mechanism="行为整活", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://finance.sina.cn/2025-01-03/detail-inecthkn8559377.d.html", note="人民日报评论:'有主播在镜头前扮演荒诞的形象,猎奇的直播风格吸引了一批粉丝'"),
    dict(id="m040", name="模仿家长反套路带娃", year="2026", origin="家长用孩子的口头禅回怼('我要验牌''给我擦皮鞋'然后'颗秒')",
         mechanism="行为整活", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="https://tidenews.com.cn/news.html?id=3439614", note="潮新闻亲读:家长'用魔法打败魔法'"),

    # ---------- 早于短视频期的谱系 ----------
    dict(id="m041", name="一个馒头引发的血案", year="2005", origin="胡戈恶搞视频",
         mechanism="恶搞/解构", dereference="半脱义", called_abstract="是(回溯)", evidence_level="H",
         url="https://wyb.chinawriter.com.cn/content/202501/20/content77868.html", note="《文艺报》张学谦原文列为'骨子里散发着抽象气息'"),
    dict(id="m042", name="中国勇夺世界杯", year="2006", origin="恶搞视频",
         mechanism="恶搞/解构", dereference="半脱义", called_abstract="是(回溯)", evidence_level="H",
         url="https://wyb.chinawriter.com.cn/content/202501/20/content77868.html", note="《文艺报》同段列举"),
    dict(id="m043", name="小兵的故事/东北人都是活雷锋", year="2000s", origin="早期Flash动画",
         mechanism="恶搞/解构", dereference="半脱义", called_abstract="是(回溯)", evidence_level="H",
         url="https://wyb.chinawriter.com.cn/content/202501/20/content77868.html", note="《文艺报》原文:'深得如今所谓抽象的精髓'"),
    dict(id="m044", name="早期B站弹幕", year="2009+", origin="二次元视频网站弹幕文化",
         mechanism="话语体系", dereference="部分脱义", called_abstract="是(回溯)", evidence_level="H",
         url="https://wyb.chinawriter.com.cn/content/202501/20/content77868.html", note="《文艺报》原文:'早期B站的视频弹幕本身就已经构成一种天然的抽象'"),
    dict(id="m045", name="火星文", year="2006", origin="早期网络语言:符号、变异汉字、方言、外来语混用",
         mechanism="话语体系", dereference="部分脱义", called_abstract="否", evidence_level="H",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》原文称其为抽象文化的前身;但本身通常不被叫抽象"),

    # ---------- 邻近但通常不被称作抽象(反例组) ----------
    dict(id="m046", name="Duang", year="2015", origin="成龙洗发水广告被鬼畜",
         mechanism="鬼畜", dereference="完全脱义", called_abstract="否", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="反例候选:空耳脱义程度极高,但公众标签是'鬼畜'而非'抽象'"),
    dict(id="m047", name="Are you OK", year="2015", origin="雷军发布会英语被鬼畜成歌",
         mechanism="鬼畜", dereference="部分脱义", called_abstract="否", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="反例候选:差评文与Duang并列"),
    dict(id="m048", name="金坷垃", year="2012", origin="化肥广告鬼畜",
         mechanism="鬼畜", dereference="完全脱义", called_abstract="否", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="反例候选:差评文列为鬼畜早期代表"),
    dict(id="m049", name="元首的愤怒", year="2012", origin="电影《帝国的毁灭》片段空耳鬼畜",
         mechanism="鬼畜/空耳", dereference="完全脱义", called_abstract="否", evidence_level="H",
         url="https://www.bianews.com/news/details?id=238808", note="反例候选:'我从河北省来'是经典空耳"),
    dict(id="m050", name="蓝瘦香菇", year="2016", origin="方言口音视频",
         mechanism="谐音", dereference="部分脱义", called_abstract="否", evidence_level="L",
         url="UNKNOWN", note="反例候选:谐音梗但通常不被称抽象"),

    # ---------- 补齐广度:其他被称抽象的现象 ----------
    dict(id="m051", name="抽象喜剧", year="2026", origin="综艺《喜人奇妙夜》等的新喜剧风格",
         mechanism="文艺形态", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.zgwypl.com/content/details48_447702.html", note="戴硕列为三特征:已读乱回、情绪突转、意义旁落;《喜人奇妙夜》全员模仿闪身步"),
    dict(id="m052", name="轻舟已过万重山,乌蒙山连着山外山", year="2025", origin="刻意错接的诗词拼接",
         mechanism="句式模板", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》原文列举的抽象话语文本"),
    dict(id="m053", name="每天都好焦虑啊,嘿嘿,焦焦的好好吃啊", year="2025", origin="情绪反逻辑接续",
         mechanism="句式模板", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》原文列举"),
    dict(id="m054", name="生活如果给我一拳,那会一拳打在棉花上", year="2025", origin="反逻辑自嘲",
         mechanism="句式模板", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://www.peopleapp.com/column/30051029267-500007266040", note="《人民论坛》原文列举"),
    dict(id="m055", name="因为我善(怼脸句式)", year="2026", origin="短视频里的无逻辑自辩",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://tidenews.com.cn/news.html?id=3439614", note="同 m017,此处作为句式族样本"),
    dict(id="m056", name="抽象整活式演唱会/明星下场", year="2026", origin="汪苏泷、杨迪、单依纯、闫妮、周笔畅、叶童等接力翻跳闪身步",
         mechanism="二创衍生", dereference="弱脱义", called_abstract="是", evidence_level="H",
         url="https://news.qq.com/rain/a/20260926A09SJB00", note="明星接力是破圈的关键节点;播放超6亿(平台口径)"),
    dict(id="m057", name="非遗翻跳", year="2026", origin="网友翻跳鼓子秧歌/花鼓灯动作",
         mechanism="动作模仿", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="http://news.e23.cn/shandong/2026-09-25/2026092500018.html", note="济南舜网报道动作来源于山东鼓子秧歌"),
    dict(id="m058", name="Z世代自嘲整活", year="2026", origin="泛指以荒诞言行娱乐众人的青年行为",
         mechanism="行为整活", dereference="部分脱义", called_abstract="是", evidence_level="H",
         url="https://wapbaike.baidu.com/item/%E7%8E%A9%E6%8A%BD%E8%B1%A1/1789915532", note="百度百科'玩抽象'定义范围"),
    dict(id="m059", name="抽象(文艺批评用法)", year="2026", origin="王颖评舞台剧:形式大而无当、内核空空如也",
         mechanism="术语挪用", dereference="语义反转", called_abstract="是", evidence_level="H",
         url="https://wenyi.gmw.cn/2026-06/09/content_38818671.htm", note="同一词被挪作文艺批评术语,与网络义相反:这里指'壳大无核'"),
    dict(id="m060", name="抽象(哲学术语)", year="汉译以来", origin="从具体事物中抽取共同属性的思维过程",
         mechanism="学术义项", dereference="原义完整", called_abstract="否", evidence_level="H",
         url="https://wapbaike.baidu.com/item/%E6%8A%BD%E8%B1%A1/65234720", note="《现代汉语词典》第7版义项①;与网络义构成同形异义,是本体的必要参照点"),
    dict(id="m061", name="颗秒(非『糖秒』)", year="2025", origin="博主「瓦瓦」的《无畏契约》小短剧(2025-11);游侠梗百科另立词条『颗秒邦邦邦邦』",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="A" if False else "M",
         url="https://tidenews.com.cn/news.html?id=3439614", note="**事实纠正**:通行写法是『颗秒』,检索未发现『糖秒』这一写法。潮新闻原文写出『颗秒!』"),
    dict(id="m062", name="曼波", year="2025", origin="空耳/音效类网络热梗",
         mechanism="空耳", dereference="完全脱义", called_abstract="是", evidence_level="M",
         url="https://m.ali213.net/news/gl2511/1716097.html", note="侦察列入空耳类7条之一;出处细节待补"),
    dict(id="m063", name="高雅人士企鹅舞", year="2025", origin="『高雅人士』+企鹅舞的复合梗",
         mechanism="动作模仿", dereference="部分脱义", called_abstract="是", evidence_level="M",
         url="https://baike.baidu.com/item/%E9%AB%98%E9%9B%85%E4%BA%BA%E5%A3%AB%E4%BC%81%E9%B9%85%E8%88%9E", note="同名百度百科条目页号为JS空壳,证据等级降为M"),
    dict(id="m064", name="丝瓜汤", year="2025", origin="短视频热梗",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.yunyingpai.com/news/1058069.html", note="硬锚点:HARD_抽象_运营派导语列举"),
    dict(id="m065", name="如何呢又能怎", year="2025", origin="短视频热梗",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.yunyingpai.com/news/1058069.html", note="硬锚点:HARD_抽象_运营派导语列举"),
    dict(id="m066", name="××基础××不基础", year="2025", origin="句式模板类热梗",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.yunyingpai.com/news/1058069.html", note="硬锚点:HARD_抽象_运营派导语列举"),
    dict(id="m067", name="咆哮体", year="2025", origin="以极端语气宣泄的网络文体",
         mechanism="句式模板", dereference="弱脱义", called_abstract="是", evidence_level="M",
         url="https://www.nfnews.com/content/G3OAwrR8or.html", note="硬锚点:HARD_抽象_南方+/新周刊原文『营造出一种抽象的氛围』"),
    dict(id="m068", name="新号别搞", year="2025", origin="网文弹幕用语",
         mechanism="句式模板", dereference="弱脱义", called_abstract="待判", evidence_level="L",
         url="UNKNOWN", note="**未找到可信出处**:仅见知乎盐选网文弹幕与TapTap社区贴,侦察判定为不可落定"),
]


def main() -> None:
    out_dir = os.path.join("lab", "data")
    os.makedirs(out_dir, exist_ok=True)

    csv_path = os.path.join(out_dir, "meme_samples.csv")
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for row in SAMPLES:
            w.writerow({k: row.get(k, "") for k in CSV_FIELDS})

    # ---- 校验 ----
    lines = []
    n = len(SAMPLES)
    ids = [s["id"] for s in SAMPLES]
    dup_ids = [i for i, c in Counter(ids).items() if c > 1]
    names = [s["name"] for s in SAMPLES]
    dup_names = [i for i, c in Counter(names).items() if c > 1]

    lines.append(f"样本总数: {n}")
    lines.append(f"字段: {', '.join(CSV_FIELDS)}")
    lines.append("")

    lines.append("[必填字段完整性]")
    required = ["id", "name", "year", "origin", "mechanism", "dereference",
                "called_abstract", "evidence_level", "url"]
    missing = []
    for s in SAMPLES:
        for k in required:
            if not str(s.get(k, "")).strip():
                missing.append(f"{s['id']}.{k}")
    lines.append("  全部齐全" if not missing else "  缺失: " + ", ".join(missing))
    lines.append("")

    lines.append("[机制分布]")
    for k, v in Counter(s["mechanism"] for s in SAMPLES).most_common():
        lines.append(f"  {k}: {v}")
    lines.append("")

    lines.append("[脱义程度分布]")
    for k, v in Counter(s["dereference"] for s in SAMPLES).most_common():
        lines.append(f"  {k}: {v}")
    lines.append("")

    lines.append("[是否被称抽象]")
    for k, v in Counter(s["called_abstract"] for s in SAMPLES).most_common():
        lines.append(f"  {k}: {v}")
    lines.append("")

    lines.append("[证据等级分布]")
    for k, v in Counter(s["evidence_level"] for s in SAMPLES).most_common():
        lines.append(f"  {k}: {v}")
    lines.append("")

    lines.append("[重复检查]")
    lines.append(f"  重复 id: {dup_ids or '无'}")
    lines.append(f"  重复 name: {dup_names or '无'}")
    lines.append("")

    lines.append("[URL 缺口]")
    no_url = [s["id"] + " " + s["name"] for s in SAMPLES if s["url"] == "UNKNOWN"]
    lines.append(f"  UNKNOWN 条数: {len(no_url)}")
    for x in no_url:
        lines.append(f"    - {x}")
    lines.append("")

    # 判据门槛
    lines.append("[判据门槛核对]")
    lines.append(f"  >=25 条样本: {'通过' if n >= 25 else '未通过'} ({n})")
    n_empty_ear = sum(1 for s in SAMPLES if s["mechanism"] == "空耳")
    n_action = sum(1 for s in SAMPLES if s["mechanism"] in ("动作模仿", "行为整活"))
    lines.append(f"  空耳类 >=3: {'通过' if n_empty_ear >= 3 else '未通过'} ({n_empty_ear})")
    lines.append(f"  动作类 >=3: {'通过' if n_action >= 3 else '未通过'} ({n_action})")
    has_url = sum(1 for s in SAMPLES if s["url"] != "UNKNOWN")
    lines.append(f"  含可访问 URL: {has_url}/{n}")

    check_path = os.path.join(out_dir, "meme_samples_check.txt")
    with open(check_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    # ---- 人读速查表 ----
    md = ["# 「抽象」热梗样本语料库", "",
          f"- 样本数: **{n}**",
          "- 证据等级: H=多源一致/权威媒体亲读 · M=单源权威或部分复核 · L=推断或未取到正文",
          "- 脱义程度: 完全脱义 / 部分脱义 / 弱脱义 / 半脱义 / 原义完整 / 语义反转",
          "",
          "| id | 名称 | 年份 | 传播机制 | 脱义程度 | 被称抽象 | 等级 |",
          "|---|---|---|---|---|---|---|"]
    for s in SAMPLES:
        md.append(f"| {s['id']} | {s['name']} | {s['year']} | {s['mechanism']} | "
                  f"{s['dereference']} | {s['called_abstract']} | {s['evidence_level']} |")
    md.append("")
    md.append("## 逐条出处与备注")
    md.append("")
    for s in SAMPLES:
        md.append(f"### {s['id']} {s['name']} ({s['year']})")
        md.append(f"- 原初出处: {s['origin']}")
        md.append(f"- 传播机制: {s['mechanism']} · 脱义程度: {s['dereference']} · 是否被称抽象: {s['called_abstract']} · 证据等级: {s['evidence_level']}")
        md.append(f"- 来源: {s['url']}")
        md.append(f"- 备注: {s['note']}")
        md.append("")

    md_path = os.path.join(out_dir, "meme_samples.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")

    print("\n".join(lines))
    print()
    print(f"已写出: {csv_path}")
    print(f"已写出: {md_path}")
    print(f"已写出: {check_path}")


if __name__ == "__main__":
    main()
