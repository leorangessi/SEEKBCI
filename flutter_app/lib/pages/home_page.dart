import 'package:flutter/material.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _selectedIndex = 0;

  final List<Widget> _pages = [
    const ProjectManagerPage(),
    const DeviceConfigPage(),
    const TestingPage(),
    const CommunityPage(),
    const ProfilePage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          // 侧边导航栏
          NavigationRail(
            selectedIndex: _selectedIndex,
            onDestinationSelected: (int index) {
              setState(() {
                _selectedIndex = index;
              });
            },
            labelType: NavigationRailLabelType.all,
            backgroundColor: const Color(0xFF1E1E1E),
            selectedIconTheme: const IconThemeData(
              color: Color(0xFF00D9FF),
              size: 28,
            ),
            unselectedIconTheme: const IconThemeData(
              color: Colors.white54,
              size: 24,
            ),
            selectedLabelTextStyle: const TextStyle(
              color: Color(0xFF00D9FF),
              fontWeight: FontWeight.bold,
            ),
            unselectedLabelTextStyle: const TextStyle(
              color: Colors.white54,
            ),
            destinations: const [
              NavigationRailDestination(
                icon: Icon(Icons.folder),
                label: Text('项目管理'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.devices),
                label: Text('设备管理'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.science),
                label: Text('测试功能'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.public),
                label: Text('社区'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.person),
                label: Text('个人中心'),
              ),
            ],
          ),
          
          const VerticalDivider(thickness: 1, width: 1),
          
          // 主内容区域
          Expanded(
            child: _pages[_selectedIndex],
          ),
        ],
      ),
    );
  }
}

// 临时占位页面
class ProjectManagerPage extends StatelessWidget {
  const ProjectManagerPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('项目管理'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              // TODO: 创建新项目
            },
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.folder_open,
              size: 100,
              color: Colors.white24,
            ),
            const SizedBox(height: 20),
            Text(
              '项目管理功能',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 10),
            Text(
              '即将推出...',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ],
        ),
      ),
    );
  }
}

class DeviceConfigPage extends StatelessWidget {
  const DeviceConfigPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('设备管理')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.devices, size: 100, color: Colors.white24),
            const SizedBox(height: 20),
            Text('设备管理功能', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 10),
            Text('即将推出...', style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      ),
    );
  }
}

class TestingPage extends StatelessWidget {
  const TestingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('测试功能')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.science, size: 100, color: Colors.white24),
            const SizedBox(height: 20),
            Text('测试功能', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 10),
            Text('即将推出...', style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      ),
    );
  }
}

class CommunityPage extends StatelessWidget {
  const CommunityPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('社区')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.public, size: 100, color: Colors.white24),
            const SizedBox(height: 20),
            Text('社区功能', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 10),
            Text('即将推出...', style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      ),
    );
  }
}

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('个人中心')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.person, size: 100, color: Colors.white24),
            const SizedBox(height: 20),
            Text('个人中心', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 10),
            Text('即将推出...', style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      ),
    );
  }
}
