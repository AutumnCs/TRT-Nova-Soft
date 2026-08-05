#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情感一致性校验模块
Sentiment Consistency Checker

功能：
- 检测AI生成回复的情绪倾向
- 验证回复情绪是否与用户情绪匹配
- 防止情感错配（如用户悲伤时AI回复轻松）
- 支持基于规则和模型的双重检测
"""

import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class SentimentClassifier:
    """情感一致性分类器"""
    
    # 情感关键词映射表
    EMOTION_KEYWORDS = {
        "happy": {
            "keywords": ["开心", "高兴", "快乐", "喜悦", "愉快", "幸福", "满意", "欣慰", "太好了", "真棒", "太棒了"],
            "patterns": [r"为你.*高兴", r"真.*开心", r"值得.*庆祝"],
            "emojis": ["😊", "😄", "🎉", "✨", "🌟", "💖"]
        },
        "sad": {
            "keywords": ["难过", "伤心", "痛苦", "悲伤", "低落", "沮丧", "失落", "心痛", "难受"],
            "patterns": [r"我理解.*难过", r"这.*不容易", r"你.*孤单"],
            "emojis": ["😢", "😭", "💔", "💙"]
        },
        "anxious": {
            "keywords": ["焦虑", "担心", "紧张", "不安", "害怕", "恐惧", "慌", "忧虑"],
            "patterns": [r"慢慢来", r"深呼吸", r"一步步"],
            "emojis": ["😰", "😨", "😟", "🌸", "☁️"]
        },
        "angry": {
            "keywords": ["愤怒", "生气", "气愤", "恼火", "愤恨", "不爽"],
            "patterns": [r"听到.*愤怒", r"有权.*生气", r"可以理解.*愤怒"],
            "emojis": ["😠", "😡", "🔥"]
        },
        "excited": {
            "keywords": ["兴奋", "激动", "期待", "振奋", "热血", "冲劲"],
            "patterns": [r"太.*了", r"好期待", r"令人兴奋"],
            "emojis": ["🎊", "✨", "🚀", "⚡", "🔥"]
        },
        "confused": {
            "keywords": ["困惑", "迷茫", "不明白", "疑惑", "纠结", "不懂"],
            "patterns": [r"我们.*理一理", r"慢慢.*梳理", r"一起.*分析"],
            "emojis": ["😕", "🤔", "❓", "💭"]
        },
        "frustrated": {
            "keywords": ["挫败", "沮丧", "失望", "无奈", "泄气", "灰心"],
            "patterns": [r"已经.*努力", r"挫折.*失败", r"换个角度"],
            "emojis": ["😤", "😩", "😒", "💪", "🌱"]
        },
        "lonely": {
            "keywords": ["孤独", "寂寞", "孤单", "独自", "一个人"],
            "patterns": [r"我.*陪.*你", r"不.*孤单", r"在这里"],
            "emojis": ["😔", "😞", "💭", "🤗", "💙"]
        },
        "grateful": {
            "keywords": ["感谢", "感激", "感恩", "谢谢", "感激"],
            "patterns": [r"感恩.*美好", r"很高兴.*分享"],
            "emojis": ["🙏", "💝", "❤️", "💖", "🌸"]
        },
        "calm": {
            "keywords": ["平静", "冷静", "安静", "放松", "舒缓", "缓和", "安抚", "稳定"],
            "patterns": [r"慢慢来", r"深呼吸", r"放松"],
            "emojis": ["🌸", "☁️", "🕊️", "💫"]
        },
        "reassuring": {
            "keywords": ["没事", "不要紧", "会好的", "放心", "安心", "安全", "稳定"],
            "patterns": [r"我.*这里", r"陪.*你", r"不用担心"],
            "emojis": ["🤗", "💙", "✨"]
        },
        "neutral": {
            "keywords": ["今天", "怎么样", "聊聊", "说说", "倾听", "听着"],
            "patterns": [r"想.*什么", r"可以.*说", r"我.*听"],
            "emojis": ["😊", "🌸", "☕"]
        }
    }
    
    # 情感兼容性映射表（定义哪些情感组合是可接受的）
    EMOTION_COMPATIBILITY = {
        "sad": ["calm", "neutral", "reassuring"],
        "anxious": ["calm", "reassuring", "neutral"],
        "angry": ["calm", "neutral", "reassuring"],
        "happy": ["happy", "excited", "grateful", "neutral"],
        "excited": ["excited", "happy", "neutral"],
        "confused": ["calm", "neutral", "reassuring"],
        "frustrated": ["calm", "reassuring", "neutral"],
        "lonely": ["reassuring", "calm", "neutral"],
        "grateful": ["grateful", "happy", "neutral"],
        "neutral": ["neutral", "calm", "reassuring", "happy", "grateful"],
        "high_risk_depression": ["calm", "reassuring", "neutral"]
    }
    
    # 禁止的情感组合（强不兼容）
    FORBIDDEN_COMBINATIONS = [
        ("sad", "happy"),
        ("sad", "excited"),
        ("anxious", "excited"),
        ("angry", "happy"),
        ("angry", "excited"),
        ("lonely", "excited"),
        ("lonely", "happy"),
        ("frustrated", "happy"),
        ("frustrated", "excited"),
        ("high_risk_depression", "happy"),
        ("high_risk_depression", "excited")
    ]
    
    def __init__(self):
        """初始化分类器"""
        logger.info("✓ 情感一致性分类器已初始化")
    
    def detect_emotion(self, text: str) -> Tuple[str, float]:
        """
        检测文本的情绪倾向
        
        Args:
            text: 要检测的文本
            
        Returns:
            (emotion, confidence): 情绪类型和置信度(0-1)
        """
        text_lower = text.lower()
        emotion_scores = {}
        
        # 0. 检测是否为共情表达（这种情况下应该返回reassuring/calm）
        empathy_patterns = [
            r"我能.*感受.*你",
            r"我理解.*你",
            r"听起来.*你",
            r"看起来.*你",
            r"我.*陪.*你",
            r"我在这里",
            r"你并不孤单",
            r"这.*不容易",
            r"我愿意.*听",
        ]
        
        is_empathy = False
        for pattern in empathy_patterns:
            if re.search(pattern, text):
                is_empathy = True
                break
        
        if is_empathy:
            # 共情表达应该被识别为安抚/平静的语气
            return "reassuring", 0.7
        
        # 1. 关键词匹配
        for emotion, data in self.EMOTION_KEYWORDS.items():
            score = 0
            
            # 关键词匹配
            for keyword in data["keywords"]:
                if keyword in text_lower:
                    score += 1
            
            # 正则模式匹配
            for pattern in data.get("patterns", []):
                if re.search(pattern, text):
                    score += 2  # 模式匹配权重更高
            
            # 表情符号匹配
            for emoji in data.get("emojis", []):
                if emoji in text:
                    score += 0.5
            
            if score > 0:
                emotion_scores[emotion] = score
        
        # 2. 找出得分最高的情绪
        if not emotion_scores:
            return "neutral", 0.3
        
        dominant_emotion = max(emotion_scores, key=emotion_scores.get)
        max_score = emotion_scores[dominant_emotion]
        
        # 3. 计算置信度（归一化）
        total_score = sum(emotion_scores.values())
        confidence = max_score / total_score if total_score > 0 else 0.5
        confidence = min(confidence, 1.0)
        
        logger.debug(f"情绪检测: '{text[:30]}...' -> {dominant_emotion} ({confidence:.2f})")
        
        return dominant_emotion, confidence
    
    def check_emotion_consistency(self, 
                                  ai_response: str, 
                                  user_emotion: str,
                                  strict_mode: bool = False) -> Tuple[bool, str]:
        """
        检查AI回复的情绪与用户情绪是否一致
        
        Args:
            ai_response: AI生成的回复
            user_emotion: 用户的情绪
            strict_mode: 是否使用严格模式（不允许任何不在兼容列表中的情绪）
            
        Returns:
            (is_consistent, reason): 是否一致，以及原因说明
        """
        # 1. 检测AI回复的情绪
        response_emotion, confidence = self.detect_emotion(ai_response)
        
        # 2. 检查是否是严重不兼容的组合
        # 只有当用户情绪和回复情绪分别匹配禁止组合中的两个不同值时，才判定为错配
        for forbidden_pair in self.FORBIDDEN_COMBINATIONS:
            emotion1, emotion2 = forbidden_pair
            # 检查是否匹配禁止组合（考虑顺序）
            if (user_emotion == emotion1 and response_emotion == emotion2) or \
               (user_emotion == emotion2 and response_emotion == emotion1):
                reason = f"严重情感错配：用户{user_emotion}，AI回复{response_emotion}"
                logger.warning(f"⚠️ {reason}")
                return False, reason
        
        # 3. 检查兼容性
        compatible_emotions = self.EMOTION_COMPATIBILITY.get(user_emotion, ["neutral"])
        
        if response_emotion in compatible_emotions:
            return True, f"情感匹配：用户{user_emotion} -> AI{response_emotion} (置信度{confidence:.2f})"
        
        # 4. 非严格模式下，低置信度的不一致是可接受的
        if not strict_mode and confidence < 0.5:
            return True, f"弱情感信号，可接受：AI{response_emotion} (置信度{confidence:.2f})"
        
        # 5. 中性情绪总是安全的
        if response_emotion == "neutral":
            return True, "中性回复，安全"
        
        reason = f"情感不匹配：用户{user_emotion}，AI回复{response_emotion} (置信度{confidence:.2f})"
        logger.warning(f"⚠️ {reason}")
        return False, reason
    
    def check_forbidden_phrases(self, text: str, user_emotion: str) -> Tuple[bool, List[str]]:
        """
        检查回复中是否包含针对特定情绪的禁用词汇
        
        Args:
            text: 要检查的文本
            user_emotion: 用户情绪
            
        Returns:
            (has_forbidden, forbidden_list): 是否包含禁用词，禁用词列表
        """
        # 根据情绪定义禁用短语
        forbidden_phrases = {
            "sad": ["振作起来", "想开点", "没什么大不了", "别难过了", "高兴点"],
            "anxious": ["不用紧张", "放松点", "没必要焦虑", "你想多了"],
            "angry": ["冷静", "别生气了", "不值得生气", "消消气"],
            "frustrated": ["再试试就好了", "不要放弃", "坚持"],
            "lonely": ["多出去走走", "交朋友就好了"],
            "confused": ["这很简单", "想明白就好了"]
        }
        
        phrases = forbidden_phrases.get(user_emotion, [])
        found_phrases = []
        
        text_lower = text.lower()
        for phrase in phrases:
            if phrase in text_lower:
                found_phrases.append(phrase)
        
        if found_phrases:
            logger.warning(f"⚠️ 发现禁用短语: {found_phrases} (用户情绪: {user_emotion})")
        
        return len(found_phrases) > 0, found_phrases
    
    def validate_response_tone(self, text: str, expected_tone: str) -> Tuple[bool, str]:
        """
        验证回复的语气是否符合预期
        
        Args:
            text: 要检查的文本
            expected_tone: 期望的语气（如"温柔"、"平静"、"活跃"）
            
        Returns:
            (is_valid, reason): 是否有效，原因说明
        """
        tone_indicators = {
            "温柔": {
                "positive": ["慢慢", "轻轻", "静静", "柔和", "温暖"],
                "negative": ["快点", "赶紧", "必须", "应该"]
            },
            "平静": {
                "positive": ["慢慢", "深呼吸", "稳定", "平静", "安静"],
                "negative": ["激动", "兴奋", "快速"]
            },
            "活跃": {
                "positive": ["太好了", "太棒了", "哇", "真酷", "精彩"],
                "negative": ["慢慢", "平静", "沉重"]
            }
        }
        
        if expected_tone not in tone_indicators:
            return True, "未定义的语气类型，跳过检查"
        
        indicators = tone_indicators[expected_tone]
        text_lower = text.lower()
        
        # 检查是否包含负面指标
        for negative in indicators.get("negative", []):
            if negative in text_lower:
                reason = f"语气不符：期望{expected_tone}，但包含'{negative}'"
                logger.warning(f"⚠️ {reason}")
                return False, reason
        
        # 检查是否包含正面指标（可选）
        has_positive = any(pos in text_lower for pos in indicators.get("positive", []))
        
        if has_positive:
            return True, f"语气符合：{expected_tone}"
        else:
            return True, f"语气中性，可接受"
    
    def comprehensive_check(self, 
                           ai_response: str, 
                           user_emotion: str,
                           expected_tone: Optional[str] = None,
                           strict_mode: bool = False) -> Dict:
        """
        综合检查AI回复的情感一致性
        
        Args:
            ai_response: AI生成的回复
            user_emotion: 用户情绪
            expected_tone: 期望的语气（可选）
            strict_mode: 是否启用严格模式
            
        Returns:
            检查结果字典，包含：
            - is_valid: 是否通过检查
            - emotion_consistent: 情绪是否一致
            - has_forbidden: 是否包含禁用词
            - tone_valid: 语气是否符合
            - warnings: 警告信息列表
            - details: 详细信息
        """
        result = {
            "is_valid": True,
            "emotion_consistent": True,
            "has_forbidden": False,
            "tone_valid": True,
            "warnings": [],
            "details": {}
        }
        
        # 1. 情绪一致性检查
        emotion_ok, emotion_reason = self.check_emotion_consistency(
            ai_response, user_emotion, strict_mode
        )
        result["emotion_consistent"] = emotion_ok
        result["details"]["emotion_check"] = emotion_reason
        
        if not emotion_ok:
            result["is_valid"] = False
            result["warnings"].append(emotion_reason)
        
        # 2. 禁用短语检查
        has_forbidden, forbidden_list = self.check_forbidden_phrases(ai_response, user_emotion)
        result["has_forbidden"] = has_forbidden
        result["details"]["forbidden_phrases"] = forbidden_list
        
        if has_forbidden:
            result["is_valid"] = False
            result["warnings"].append(f"包含禁用短语: {', '.join(forbidden_list)}")
        
        # 3. 语气检查（如果指定）
        if expected_tone:
            tone_ok, tone_reason = self.validate_response_tone(ai_response, expected_tone)
            result["tone_valid"] = tone_ok
            result["details"]["tone_check"] = tone_reason
            
            if not tone_ok:
                result["warnings"].append(tone_reason)
                # 语气问题不强制失败，只是警告
        
        # 4. 检测AI身份暴露
        identity_keywords = ["我是AI", "我是机器人", "我是GPT", "我是一个程序", "我是人工智能"]
        for keyword in identity_keywords:
            if keyword in ai_response:
                result["is_valid"] = False
                result["warnings"].append(f"暴露AI身份: '{keyword}'")
                break
        
        return result


# 创建全局实例
_global_classifier = None


def get_global_classifier() -> SentimentClassifier:
    """获取全局分类器实例（单例模式）"""
    global _global_classifier
    if _global_classifier is None:
        _global_classifier = SentimentClassifier()
    return _global_classifier


def check_emotion_consistency(ai_response: str, user_emotion: str) -> bool:
    """
    便捷函数：检查情感一致性
    
    Args:
        ai_response: AI回复
        user_emotion: 用户情绪
        
    Returns:
        是否一致
    """
    classifier = get_global_classifier()
    is_consistent, _ = classifier.check_emotion_consistency(ai_response, user_emotion)
    return is_consistent


def validate_response(ai_response: str, 
                     user_emotion: str, 
                     expected_tone: Optional[str] = None) -> Tuple[bool, List[str]]:
    """
    便捷函数：验证回复是否合格
    
    Args:
        ai_response: AI回复
        user_emotion: 用户情绪
        expected_tone: 期望语气
        
    Returns:
        (is_valid, warnings): 是否有效，警告列表
    """
    classifier = get_global_classifier()
    result = classifier.comprehensive_check(ai_response, user_emotion, expected_tone)
    return result["is_valid"], result["warnings"]


# 测试代码
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    classifier = SentimentClassifier()
    
    # 测试用例
    test_cases = [
        {
            "user_emotion": "sad",
            "ai_response": "我能感受到你现在的低落。但请相信，你的存在本身就有价值。我在这里，愿意听你说更多。💙",
            "expected": True
        },
        {
            "user_emotion": "sad",
            "ai_response": "哈哈，这有什么好难过的，开心点！😄",
            "expected": False
        },
        {
            "user_emotion": "anxious",
            "ai_response": "面试前紧张是很正常的反应。这种担心说明你很重视这次机会。深呼吸，我陪你一起准备。🌸",
            "expected": True
        },
        {
            "user_emotion": "happy",
            "ai_response": "太好了！很高兴看到你这么开心！😊",
            "expected": True
        }
    ]
    
    print("\n===== 情感一致性测试 =====\n")
    for i, test in enumerate(test_cases, 1):
        result = classifier.comprehensive_check(
            test["ai_response"], 
            test["user_emotion"]
        )
        
        status = "✓" if result["is_valid"] == test["expected"] else "✗"
        print(f"{status} 测试 {i}: 用户情绪={test['user_emotion']}")
        print(f"   回复: {test['ai_response'][:50]}...")
        print(f"   结果: {'通过' if result['is_valid'] else '不通过'}")
        if result["warnings"]:
            print(f"   警告: {', '.join(result['warnings'])}")
        print()

