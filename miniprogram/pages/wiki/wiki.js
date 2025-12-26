const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    posts: [
      {
        id: 1,
        username: "植物达人",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop",
        time: "2小时前",
        content: "今天的芦荟状态真好！大家看看我的养护成果。🌿",
        image: "https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop",
        likes: 128,
        isLiked: true,
        comments: 32
      },
      {
        id: 2,
        username: "新手小白",
        avatar: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?q=80&w=100&auto=format&fit=crop",
        time: "5小时前",
        content: "求助：为什么我的多肉叶子变黄了？是不是浇水太多了？😭",
        image: null,
        likes: 15,
        isLiked: false,
        comments: 48
      },
      {
        id: 3,
        username: "园艺专家",
        avatar: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=100&auto=format&fit=crop",
        time: "1天前",
        content: "分享一些关于室内补光的技巧，建议大家根据植物习性调整光谱。",
        image: "https://images.unsplash.com/photo-1463936575229-4699413f3030?q=80&w=600&auto=format&fit=crop",
        likes: 542,
        isLiked: false,
        comments: 89
      }
    ],
    filteredPosts: []
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      filteredPosts: this.data.posts
    });
  },

  onInputSearch: function(e) {
    const keyword = e.detail.value.toLowerCase();
    const filtered = this.data.posts.filter(p => 
      p.content.toLowerCase().includes(keyword) || 
      p.username.toLowerCase().includes(keyword)
    );
    this.setData({ filteredPosts: filtered });
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
  },

  onLike: function(e) {
    const id = e.currentTarget.dataset.id;
    const posts = this.data.posts.map(p => {
      if (p.id === id) {
        wx.vibrateShort({ type: 'light' });
        return {
          ...p,
          isLiked: !p.isLiked,
          likes: !p.isLiked ? p.likes + 1 : p.likes - 1
        };
      }
      return p;
    });
    this.setData({ posts, filteredPosts: posts });
  },

  onComment: function(e) {
    this.setData({
      showCommentInput: true,
      activePostId: e.currentTarget.dataset.id,
      // More mock comments with details
      currentComments: [
        { 
          id: 1,
          user: '花友A', 
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop',
          content: '真的很有用！感谢分享。我家那盆也遇到了一样的问题，回去试试看。', 
          time: '10分钟前',
          likes: 5
        },
        { 
          id: 2,
          user: '路人B', 
          avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?q=80&w=100&auto=format&fit=crop',
          content: '我也遇到了这个问题，试试楼主的方法。', 
          time: '30分钟前',
          likes: 2
        },
        { 
          id: 3,
          user: '园艺小萌新', 
          avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=100&auto=format&fit=crop',
          content: '请问这个需要每天都浇水吗？感觉土一直干不了。', 
          time: '1小时前',
          likes: 0
        },
        { 
          id: 4,
          user: '植物医生', 
          avatar: 'https://images.unsplash.com/photo-1463936575229-4699413f3030?q=80&w=100&auto=format&fit=crop',
          content: '回复 @园艺小萌新：看土壤表面，干透了再浇透，不要积水。', 
          time: '50分钟前',
          likes: 12
        }
      ]
    });
  },

  closeComment: function() {
    this.setData({
      showCommentInput: false,
      activePostId: null,
      currentComments: []
    });
  },

  stopProp: function() {},

  sendComment: function() {
    wx.showToast({
      title: '评论已发送',
      icon: 'success'
    });
    this.closeComment();
  },

  onPost: function() {
    wx.vibrateShort({ type: 'medium' });
    wx.showActionSheet({
      itemList: ['发布图文', '发布视频', '提问'],
      success: (res) => {
        wx.showToast({
          title: '功能开发中',
          icon: 'none'
        })
      }
    })
  }
})