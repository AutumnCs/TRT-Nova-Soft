#!/usr/bin/env python3
"""
测试Agent工具函数

测试文档中提到的5个核心工具函数：
1. get_user_mood_trend()
2. play_meditation_audio()
3. set_daily_reminder()
4. search_mental_health_resources()
5. send_follow_up_message()
"""

import sys
import os
import asyncio
import json
from datetime import datetime

# 添加项目根目录到路径
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

from backend.agent.tools.agent_tools import (
    get_user_mood_trend,
    play_meditation_audio,
    set_daily_reminder,
    search_mental_health_resources,
    send_follow_up_message
)
from backend.agent.tool_caller import get_tool_caller


def test_get_user_mood_trend():
    """测试获取用户情绪趋势"""
    print("=" * 60)
    print("测试 1: get_user_mood_trend()")
    print("=" * 60)
    
    user_id = "test_user_001"
    result = get_user_mood_trend(user_id, days=7)
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print()


def test_play_meditation_audio():
    """测试播放冥想音频"""
    print("=" * 60)
    print("测试 2: play_meditation_audio()")
    print("=" * 60)
    
    # 测试不同类型的音频
    genres = ["sleep", "anxiety", "relaxation", "breathing"]
    
    for genre in genres:
        print(f"\n测试类型: {genre}")
        result = play_meditation_audio(genre, user_id="test_user_001")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    print()


def test_set_daily_reminder():
    """测试设置每日提醒"""
    print("=" * 60)
    print("测试 3: set_daily_reminder()")
    print("=" * 60)
    
    result = set_daily_reminder(
        time="21:30",
        message="今晚早点放松哦，记得做睡前冥想",
        user_id="test_user_001"
    )
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print()


def test_search_mental_health_resources():
    """测试搜索心理健康资源"""
    print("=" * 60)
    print("测试 4: search_mental_health_resources()")
    print("=" * 60)
    
    queries = ["焦虑", "睡眠", "压力", "抑郁"]
    
    for query in queries:
        print(f"\n搜索关键词: {query}")
        result = search_mental_health_resources(query)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    print()


def test_send_follow_up_message():
    """测试发送回访消息"""
    print("=" * 60)
    print("测试 5: send_follow_up_message()")
    print("=" * 60)
    
    result = send_follow_up_message(
        user_id="test_user_001",
        days_ago=1,
        custom_message="你好，距离我们上次聊天已经过去1天了。最近感觉怎么样？"
    )
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print()


async def test_tool_caller_integration():
    """测试通过ToolCaller调用工具"""
    print("=" * 60)
    print("测试 6: 通过ToolCaller调用工具")
    print("=" * 60)
    
    tool_caller = get_tool_caller()
    
    # 列出所有工具
    print("\n可用工具列表：")
    for tool in tool_caller.registry.list_tools():
        print(f"  - {tool.name}: {tool.description}")
    
    print("\n" + "=" * 60)
    
    # 测试调用get_user_mood_trend
    print("\n测试调用: get_user_mood_trend")
    result = await tool_caller.call(
        "get_user_mood_trend",
        {
            "user_id": "test_user_001",
            "days": 7
        }
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 测试调用play_meditation_audio
    print("\n测试调用: play_meditation_audio")
    result = await tool_caller.call(
        "play_meditation_audio",
        {
            "genre": "sleep",
            "user_id": "test_user_001"
        }
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 测试调用set_daily_reminder
    print("\n测试调用: set_daily_reminder")
    result = await tool_caller.call(
        "set_daily_reminder",
        {
            "time": "21:00",
            "message": "该冥想啦，今晚试试'星空呼吸'吧 🌌",
            "user_id": "test_user_001"
        }
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 测试调用search_mental_health_resources
    print("\n测试调用: search_mental_health_resources")
    result = await tool_caller.call(
        "search_mental_health_resources",
        {
            "query": "焦虑",
            "resource_type": "article"
        }
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 测试调用send_follow_up_message
    print("\n测试调用: send_follow_up_message")
    result = await tool_caller.call(
        "send_follow_up_message",
        {
            "user_id": "test_user_001",
            "days_ago": 1
        }
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    """主测试函数"""
    print("\n" + "=" * 60)
    print("Agent工具函数测试")
    print("=" * 60 + "\n")
    
    # 测试直接调用工具函数
    test_get_user_mood_trend()
    test_play_meditation_audio()
    test_set_daily_reminder()
    test_search_mental_health_resources()
    test_send_follow_up_message()
    
    # 测试通过ToolCaller调用
    print("\n" + "=" * 60)
    print("开始测试ToolCaller集成...")
    print("=" * 60 + "\n")
    asyncio.run(test_tool_caller_integration())
    
    print("\n" + "=" * 60)
    print("所有测试完成！")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()

